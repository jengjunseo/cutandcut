import { useEffect, useRef, useState } from 'react';
import { SkipBack, SkipForward, Play, Pause, Film, Upload, Maximize } from 'lucide-react';
import type { Clip, Project } from './model';
import { duration, timecode, frameTick, editable, linked } from './model';
import { createEngine, files } from './engine';
import { IconButton } from './ui';
import { fitPreview } from './geometry';
import TimeInput from './TimeInput';
type Props = {
  project: Project;
  time: number;
  playing: boolean;
  rate: number;
  selected: string[];
  seek: (t: number) => void;
  toggle: () => void;
  importFiles: () => void;
  mediaAction: () => void;
  mediaActionLabel: string;
  update: (p: Project) => void;
  notify: (s: string) => void;
  playRange: () => void;
  capture: () => void;
  processing: string;
  meter: React.ReactNode;
};
export default function Preview({
  project: p,
  time,
  playing,
  rate,
  selected,
  seek,
  toggle,
  importFiles,
  mediaAction,
  mediaActionLabel,
  update,
  notify,
  playRange,
  capture,
  processing,
  meter,
}: Props) {
  const canvas = useRef<HTMLCanvasElement>(null),
    stage = useRef<HTMLDivElement>(null),
    worker = useRef<Worker>(null),
    seq = useRef(0),
    registered = useRef(new Map<string, File>()),
    latest = useRef({ p, time, playing });
  latest.current = { p, time, playing };
  const [error, setError] = useState('');
  const [bounds, setBounds] = useState({ width: 640, height: 360 });
  const [quality, setQuality] = useState(1),
    [cropMode, setCropMode] = useState(false),
    [gesture, setGesture] = useState<Clip>();
  const fitted = fitPreview(bounds.width, bounds.height, p.width / p.height);
  const width = Math.round(fitted.width);
  useEffect(() => {
    seq.current++;
    setError('');
    const c = canvas.current;
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
    let w: Worker;
    try {
      w = createEngine();
    } catch (e) {
      worker.current = null;
      setError(e instanceof Error ? e.message : '미리보기 엔진을 시작할 수 없습니다.');
      return;
    }
    worker.current = w;
    w.onmessage = (e) => {
      if (e.data.type === 'frame') {
        const bitmap = e.data.bitmap as ImageBitmap;
        if ((e.data.seq === seq.current || latest.current.playing) && canvas.current) {
          const c = canvas.current;
          c.width = bitmap.width;
          c.height = bitmap.height;
          c.getContext('2d')!.drawImage(bitmap, 0, 0);
          setError('');
        }
        bitmap.close();
      } else if (e.data.type === 'preview-error') setError(e.data.error);
    };
    w.onerror = () =>
      setError('미리보기 엔진을 시작할 수 없습니다. Chrome 또는 Edge에서 다시 시도하세요.');
    return () => {
      w.terminate();
      worker.current = null;
      registered.current.clear();
    };
  }, [p.id]);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setBounds({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    if (stage.current) observer.observe(stage.current);
    return () => observer.disconnect();
  }, []);
  function renderPreview(project: Project) {
    try {
      worker.current?.postMessage({
        type: 'preview',
        project,
        time,
        seq: ++seq.current,
        width: Math.max(16, Math.round(Math.min(960, width) * quality)),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : '미리보기 요청을 전달할 수 없습니다.');
    }
  }
  useEffect(() => {
    const w = worker.current;
    if (!w || !p.clips.length) return;
    try {
      for (const a of p.assets) {
        const file = files.get(a.id);
        if (file && registered.current.get(a.id) !== file) {
          w.postMessage({ type: 'file', id: a.id, file });
          registered.current.set(a.id, file);
        }
      }
      renderPreview(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : '미리보기 원본을 전달할 수 없습니다.');
    }
  }, [p, time, width, quality]);
  const selectedText = p.clips.find((c) => selected.includes(c.id) && c.kind !== 'audio');
  const locked = selectedText && !editable(p, linked(p, [selectedText.id]));
  useEffect(() => setCropMode(false), [selectedText?.id, selectedText?.rotation]);
  function dragText(
    event: React.PointerEvent,
    mode: 'move' | 'scale' | 'crop-start' | 'crop-end' = 'move',
  ) {
    event.stopPropagation();
    event.preventDefault();
    if (!selectedText || !stage.current || locked || event.button !== 0) return;
    const base = p,
      clip = selectedText,
      startX = event.clientX,
      startY = event.clientY;
    const rect = canvas.current!.getBoundingClientRect();
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    let next = p;
    const move = (e: PointerEvent) => {
      const dx = (e.clientX - startX) / rect.width,
        dy = (e.clientY - startY) / rect.height;
      let value: Partial<Clip> = { x: clip.x + dx, y: clip.y + dy };
      if (mode === 'scale') value = { scale: Math.max(0.01, Math.min(5, clip.scale + dx * 2)) };
      if (mode.startsWith('crop')) {
        const crop = { left: 0, right: 0, top: 0, bottom: 0, ...clip.crop };
        if (mode === 'crop-start') {
          crop.left = Math.max(0, Math.min(0.95 - crop.right, crop.left + dx / clip.scale));
          crop.top = Math.max(0, Math.min(0.95 - crop.bottom, crop.top + dy / clip.scale));
        } else {
          crop.right = Math.max(0, Math.min(0.95 - crop.left, crop.right - dx / clip.scale));
          crop.bottom = Math.max(0, Math.min(0.95 - crop.top, crop.bottom - dy / clip.scale));
        }
        value = { crop };
      }
      if (mode === 'move') {
        if (Math.abs(value.x! - 0.5) < 0.015) value.x = 0.5;
        if (Math.abs(value.y! - 0.5) < 0.015) value.y = 0.5;
      }
      next = {
        ...base,
        clips: base.clips.map((c) =>
          c.id === clip.id
            ? {
                ...c,
                ...value,
              }
            : c,
        ),
      };
      setGesture(next.clips.find((c) => c.id === clip.id));
      renderPreview(next);
    };
    const cleanup = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key);
      if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    };
    const end = () => {
      cleanup();
      setGesture(undefined);
      update(next);
    };
    const cancel = () => {
      cleanup();
      setGesture(undefined);
      target.style.left = `${clip.x * 100}%`;
      target.style.top = `${clip.y * 100}%`;
      renderPreview(base);
      update(base);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end, { once: true });
    target.addEventListener('pointercancel', cancel, { once: true });
    window.addEventListener('keydown', key);
  }
  const shown = gesture ?? selectedText;
  const asset = p.assets.find((a) => a.id === shown?.assetId),
    crop = shown?.crop ?? { left: 0, right: 0, top: 0, bottom: 0 };
  const sourceWidth = (asset?.width ?? p.width) * (1 - crop.left - crop.right),
    sourceHeight = (asset?.height ?? p.height) * (1 - crop.top - crop.bottom);
  const fit =
    shown?.fit === 'cover'
      ? Math.max(fitted.width / sourceWidth, fitted.height / sourceHeight)
      : Math.min(fitted.width / sourceWidth, fitted.height / sourceHeight);
  return (
    <section className="preview-panel" aria-label="미리보기">
      <div className="panel-top">
        <span className="eyebrow">미리보기</span>
        <div className="preview-meta">
          <select
            aria-label="미리보기 품질"
            title="출력 해상도는 유지됩니다. 프록시 파일을 생성하지 않습니다."
            value={quality}
            onChange={(e) => setQuality(Number(e.target.value))}
          >
            <option value={1}>미리보기 100%</option>
            <option value={0.5}>미리보기 50%</option>
            <option value={0.25}>미리보기 25%</option>
          </select>
          <button
            className="text-tool"
            aria-pressed={p.safeArea ?? false}
            onClick={() => update({ ...p, safeArea: !p.safeArea })}
          >
            안전 영역
          </button>
          {selectedText && selectedText.kind !== 'text' ? (
            <button
              className="text-tool"
              disabled={!!locked || selectedText.rotation !== 0}
              aria-pressed={cropMode}
              onClick={() => setCropMode(!cropMode)}
            >
              크롭 핸들
            </button>
          ) : null}
          <button
            className="text-tool"
            disabled={!p.clips.length || !!processing}
            onClick={capture}
          >
            정지 프레임
          </button>
          <span>
            {p.width} × {p.height}
          </span>
          <span>{p.fps} FPS</span>
          <span className="dot-separator" />
          <span>로컬 처리</span>
          <IconButton
            label="미리보기 전체 화면"
            onClick={() => {
              void stage.current
                ?.requestFullscreen()
                .catch(() => notify('이 환경은 전체 화면을 지원하지 않습니다.'));
            }}
          >
            <Maximize size={15} />
          </IconButton>
        </div>
      </div>
      <div className="preview-area" ref={stage}>
        <div
          className="canvas-wrap"
          style={{
            width: fitted.width,
            height: fitted.height,
            aspectRatio: `${p.width}/${p.height}`,
          }}
        >
          {p.clips.length ? (
            <>
              <canvas ref={canvas} aria-label="프로젝트 합성 영상" />
              {p.safeArea ? (
                <div className="safe-area" aria-label="10% 자막 안전 영역">
                  <span />
                  <span />
                </div>
              ) : null}
              {selectedText &&
              time >= selectedText.start &&
              time < selectedText.start + selectedText.duration ? (
                <div
                  className={`text-selection visual-selection ${locked ? 'selection-locked' : ''}`}
                  style={{
                    left: `${shown!.x * 100}%`,
                    top: `${shown!.y * 100}%`,
                    width:
                      selectedText.kind === 'text' ? undefined : sourceWidth * fit * shown!.scale,
                    height:
                      selectedText.kind === 'text' ? undefined : sourceHeight * fit * shown!.scale,
                    transform: `translate(-50%,-50%) rotate(${shown!.rotation}deg)`,
                  }}
                  onPointerDown={dragText}
                  title={locked ? '잠긴 트랙' : '드래그하여 위치 변경 · 중앙에 스냅'}
                >
                  {selectedText.kind === 'text' ? (
                    <span>{selectedText.text?.text || '텍스트'}</span>
                  ) : null}
                  {!locked ? (
                    <>
                      <button
                        aria-label={cropMode ? '왼쪽 위 크롭 핸들' : '클립 크기 조절 핸들'}
                        className="visual-handle start"
                        onPointerDown={(e) => dragText(e, cropMode ? 'crop-start' : 'scale')}
                      />
                      <button
                        aria-label={
                          cropMode ? '오른쪽 아래 크롭 핸들' : '클립 크기 조절 핸들 오른쪽'
                        }
                        className="visual-handle end"
                        onPointerDown={(e) => dragText(e, cropMode ? 'crop-end' : 'scale')}
                      />
                    </>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <button
              type="button"
              className="start-canvas"
              onClick={p.assets.length ? mediaAction : importFiles}
              aria-label={p.assets.length ? mediaActionLabel : '파일 선택'}
              aria-describedby="start-guide"
            >
              <span className="start-mark" aria-hidden="true">
                <Film size={30} strokeWidth={1.4} />
                <span className="tiny-plus">+</span>
              </span>
              <strong className="start-title">
                {p.assets.length
                  ? '보관함의 미디어로 편집을 시작하세요.'
                  : '이야기의 시작, 첫 번째 클립'}
              </strong>
              <span className="start-copy" id="start-guide">
                {p.assets.length
                  ? '아직 타임라인에 클립이 없습니다. 선택한 파일을 배치하거나 보관함의 + 버튼을 누르세요.'
                  : '영상, 이미지, 음악을 여기에 끌어놓으세요.'}
              </span>
              <span className="primary">
                {p.assets.length ? <Film size={16} /> : <Upload size={16} />}
                {p.assets.length ? mediaActionLabel : '파일 선택'}
              </span>
              <span className="local-note">원본 파일은 기기 안에 머무릅니다.</span>
            </button>
          )}
          {error ? (
            <div className="preview-error" role="alert">
              {error}
            </div>
          ) : null}
        </div>
      </div>
      <div className="transport">
        <TimeInput time={time} fps={p.fps} seek={seek} notify={notify} />
        <div className="transport-controls">
          <IconButton
            label="이전 프레임 (←)"
            onClick={() => seek(Math.max(0, time - frameTick(1, p.fps)))}
          >
            <SkipBack size={17} />
          </IconButton>
          <button
            className="play-button"
            aria-label={playing ? '일시정지 (Space)' : '재생 (Space)'}
            disabled={!p.clips.length}
            onClick={toggle}
          >
            {playing ? (
              <Pause size={20} fill="currentColor" />
            ) : (
              <Play size={20} fill="currentColor" />
            )}
          </button>
          <IconButton
            label="다음 프레임 (→)"
            onClick={() => seek(Math.min(duration(p), time + frameTick(1, p.fps)))}
          >
            <SkipForward size={17} />
          </IconButton>
        </div>
        <span className="timecode total-time">{timecode(duration(p), p.fps)}</span>
        {p.workRange && p.workRange.end > p.workRange.start ? (
          <button className="text-tool" onClick={playRange}>
            I/O 재생
          </button>
        ) : null}
        <span className="playback-rate">{rate < 0 ? '역방향 프레임 탐색' : `${rate}×`}</span>
        {meter}
      </div>
    </section>
  );
}
