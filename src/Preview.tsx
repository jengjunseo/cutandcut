import { useEffect, useRef, useState } from 'react';
import { SkipBack, SkipForward, Play, Pause, Film, Upload, Maximize, Volume2 } from 'lucide-react';
import type { Clip, Project } from './model';
import { duration, timecode, frameTick } from './model';
import { createEngine, files } from './engine';
import { IconButton } from './ui';
type Props = {
  project: Project;
  time: number;
  playing: boolean;
  rate: number;
  selected: string[];
  seek: (t: number) => void;
  toggle: () => void;
  importFiles: () => void;
  update: (p: Project) => void;
  notify: (s: string) => void;
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
  update,
  notify,
}: Props) {
  const canvas = useRef<HTMLCanvasElement>(null),
    stage = useRef<HTMLDivElement>(null),
    worker = useRef<Worker>(null),
    seq = useRef(0),
    registered = useRef(new Map<string, File>()),
    latest = useRef({ p, time, playing });
  latest.current = { p, time, playing };
  const [error, setError] = useState('');
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const w = createEngine();
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
      registered.current.clear();
    };
  }, []);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(320, Math.round(entry.contentRect.width))),
    );
    if (stage.current) observer.observe(stage.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const w = worker.current;
    if (!w || !p.clips.length) return;
    for (const a of p.assets) {
      const file = files.get(a.id);
      if (file && registered.current.get(a.id) !== file) {
        w.postMessage({ type: 'file', id: a.id, file });
        registered.current.set(a.id, file);
      }
    }
    w.postMessage({
      type: 'preview',
      project: p,
      time,
      seq: ++seq.current,
      width: Math.min(960, width),
    });
  }, [p, time, width]);
  const selectedText = p.clips.find((c) => selected.includes(c.id) && c.kind === 'text');
  function dragText(event: React.PointerEvent) {
    if (!selectedText || !stage.current) return;
    const base = p,
      clip = selectedText,
      startX = event.clientX,
      startY = event.clientY;
    const rect = canvas.current!.getBoundingClientRect();
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    let next = p;
    const move = (e: PointerEvent) => {
      next = {
        ...base,
        clips: base.clips.map((c) =>
          c.id === clip.id
            ? {
                ...c,
                x: clip.x + (e.clientX - startX) / rect.width,
                y: clip.y + (e.clientY - startY) / rect.height,
              }
            : c,
        ),
      };
      if (worker.current)
        worker.current.postMessage({
          type: 'preview',
          project: next,
          time,
          seq: ++seq.current,
          width,
        });
      target.style.left = `${next.clips.find((c) => c.id === clip.id)!.x * 100}%`;
      target.style.top = `${next.clips.find((c) => c.id === clip.id)!.y * 100}%`;
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
      update(next);
    };
    const cancel = () => {
      cleanup();
      target.style.left = `${clip.x * 100}%`;
      target.style.top = `${clip.y * 100}%`;
      worker.current?.postMessage({
        type: 'preview',
        project: base,
        time,
        seq: ++seq.current,
        width,
      });
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
  return (
    <section className="preview-panel" aria-label="미리보기">
      <div className="panel-top">
        <span className="eyebrow">미리보기</span>
        <div className="preview-meta">
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
          style={
            {
              aspectRatio: `${p.width}/${p.height}`,
              '--aspect': p.width / p.height,
            } as React.CSSProperties
          }
        >
          {p.clips.length ? (
            <>
              <canvas ref={canvas} aria-label="프로젝트 합성 영상" />
              {selectedText &&
              time >= selectedText.start &&
              time < selectedText.start + selectedText.duration ? (
                <div
                  className="text-selection"
                  style={{ left: `${selectedText.x * 100}%`, top: `${selectedText.y * 100}%` }}
                  onPointerDown={dragText}
                  title="드래그하여 텍스트 위치 변경"
                >
                  <span>{selectedText.text?.text || '텍스트'}</span>
                </div>
              ) : null}
            </>
          ) : (
            <div
              className="start-canvas"
              onClick={importFiles}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') importFiles();
              }}
            >
              <div className="start-mark">
                <Film size={30} strokeWidth={1.4} />
                <span className="tiny-plus">+</span>
              </div>
              <h1>이야기의 시작, 첫 번째 클립</h1>
              <p>영상, 이미지, 음악을 여기에 끌어놓으세요.</p>
              <button
                className="primary"
                onClick={(e) => {
                  e.stopPropagation();
                  importFiles();
                }}
              >
                <Upload size={16} /> 파일 선택
              </button>
              <span className="local-note">원본 파일은 기기 안에 머무릅니다.</span>
            </div>
          )}
          {error ? (
            <div className="preview-error" role="alert">
              {error}
            </div>
          ) : null}
        </div>
      </div>
      <div className="transport">
        <span className="timecode current-time">{timecode(time, p.fps)}</span>
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
        <span className="playback-rate">{rate < 0 ? '역방향 프레임 탐색' : `${rate}×`}</span>
        <Volume2 className="transport-volume" size={16} />
      </div>
    </section>
  );
}
