import { useState, useEffect, useRef } from 'react';
import {
  X,
  Download,
  CheckCircle2,
  LoaderCircle,
  TriangleAlert,
  Monitor,
  ArrowRight,
} from 'lucide-react';
import { duration, seconds, type Project } from './model';
import { checkCapabilities, createEngine, files, type Capabilities } from './engine';
import { download } from './storage';
import { Field, IconButton, formatBytes } from './ui';
type Props = { project: Project; onClose: () => void };
export default function ExportDialog({ project, onClose }: Props) {
  const [snapshot] = useState(() => structuredClone(project));
  const [format, setFormat] = useState<'mp4' | 'webm' | 'wav' | 'mp3'>('mp4'),
    [quality, setQuality] = useState('standard'),
    [bitrate, setBitrate] = useState(8),
    [filename, setFilename] = useState(snapshot.name),
    [caps, setCaps] = useState<Capabilities | null>(null),
    [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error' | 'cancelled'>('idle'),
    [progress, setProgress] = useState(0),
    [stage, setStage] = useState(''),
    [error, setError] = useState(''),
    [blob, setBlob] = useState<Blob | null>(null);
  const worker = useRef<Worker | null>(null),
    generation = useRef(0),
    dialog = useRef<HTMLDivElement>(null);
  const missing = snapshot.assets.filter(
    (a) => snapshot.clips.some((c) => c.assetId === a.id) && !files.has(a.id),
  );
  const length = seconds(duration(snapshot));
  useEffect(() => {
    let active = true;
    setCaps(null);
    void checkCapabilities(snapshot, bitrate * 1e6)
      .then((c) => {
        if (active) {
          setCaps(c);
          setFormat((f) => (c[f] ? f : c.webm ? 'webm' : 'wav'));
        }
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
          setCaps({ mp4: false, webm: false, wav: true, mp3: false, vp9: false });
          setFormat('wav');
        }
      });
    return () => {
      active = false;
    };
  }, [snapshot, bitrate]);
  useEffect(() => {
    const old = document.activeElement as HTMLElement;
    dialog.current?.focus();
    return () => {
      worker.current?.terminate();
      old?.focus();
    };
  }, []);
  function start() {
    setStatus('running');
    setError('');
    setBlob(null);
    setProgress(0);
    setStage('엔진 시작');
    worker.current?.terminate();
    const w = createEngine();
    worker.current = w;
    const gen = ++generation.current;
    for (const a of snapshot.assets) {
      const file = files.get(a.id);
      if (file) w.postMessage({ type: 'file', id: a.id, file });
    }
    w.onmessage = (e) => {
      if (gen !== generation.current) return;
      const d = e.data;
      if (d.type === 'progress') {
        setProgress(d.progress);
        setStage(d.stage + (d.frames ? ` · ${d.frames}/${d.total} 프레임` : ''));
      } else if (d.type === 'complete') {
        const result = new Blob([d.buffer], {
          type:
            format === 'mp4'
              ? 'video/mp4'
              : format === 'webm'
                ? 'video/webm'
                : format === 'mp3'
                  ? 'audio/mpeg'
                  : 'audio/wav',
        });
        setBlob(result);
        setStatus('done');
        w.terminate();
        worker.current = null;
      } else if (d.type === 'error') {
        setError(d.error);
        setStatus('error');
        w.terminate();
        worker.current = null;
      }
    };
    w.onerror = (e) => {
      setStatus('error');
      setError(e.message || '내보내기 Worker를 실행할 수 없습니다.');
      w.terminate();
      worker.current = null;
    };
    w.postMessage({ type: 'export', project: snapshot, format, bitrate: bitrate * 1e6 });
  }
  function cancel() {
    generation.current++;
    worker.current?.terminate();
    worker.current = null;
    setStatus('cancelled');
    setStage('내보내기를 취소했습니다. 프로젝트는 유지됩니다.');
  }
  const [outputUrl, setOutputUrl] = useState('');
  useEffect(() => {
    if (!blob) {
      setOutputUrl('');
      return;
    }
    const url = URL.createObjectURL(blob);
    setOutputUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  const canExport = !!caps?.[format] && !missing.length && length > 0 && length <= 300;
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && status !== 'running') onClose();
      }}
    >
      <div
        className="export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-title"
        tabIndex={-1}
        ref={dialog}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            if (status === 'running') cancel();
            else onClose();
          }
          if (e.key === 'Tab') {
            const items = Array.from(
              dialog.current!.querySelectorAll<HTMLElement>(
                'button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]',
              ),
            );
            const first = items[0],
              last = items.at(-1);
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last?.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">마지막 한 단계</span>
            <h2 id="export-title">이야기를 파일로 완성하세요.</h2>
          </div>
          <IconButton label="내보내기 닫기" disabled={status === 'running'} onClick={onClose}>
            <X size={20} />
          </IconButton>
        </div>
        <div className="export-summary">
          <Monitor size={24} />
          <div>
            <strong>
              {snapshot.width} × {snapshot.height}
            </strong>
            <span>
              {snapshot.fps} FPS · {length.toFixed(2)}초 · 프로젝트 스냅샷
            </span>
          </div>
          <span className="local-pill">기기에서 처리</span>
        </div>
        {status !== 'running' && status !== 'done' ? (
          <>
            <Field label="파일 이름">
              <input value={filename} onChange={(e) => setFilename(e.target.value)} />
            </Field>
            <Field label="파일 형식">
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as typeof format)}
                disabled={!caps}
              >
                <option value="mp4" disabled={!caps?.mp4}>
                  MP4 · H.264 + AAC{caps && !caps.mp4 ? ' (현재 환경 미지원)' : ''}
                </option>
                <option value="webm" disabled={!caps?.webm}>
                  WebM · {caps?.vp9 ? 'VP9' : 'VP8'} + Opus
                  {caps && !caps.webm ? ' (현재 환경 미지원)' : ''}
                </option>
                <option value="wav">WAV · PCM 16-bit · 오디오만</option>
                <option value="mp3" disabled={!caps?.mp3}>
                  MP3 · LAME 192kbps · 오디오만
                </option>
              </select>
            </Field>
            {format === 'mp4' || format === 'webm' ? (
              <>
                <Field label="품질">
                  <div className="segmented">
                    {[
                      ['low', '낮음', 3],
                      ['standard', '표준', 8],
                      ['high', '높음', 16],
                    ].map(([key, label, value]) => (
                      <button
                        key={key}
                        className={quality === key ? 'selected' : ''}
                        onClick={() => {
                          setQuality(String(key));
                          setBitrate(Number(value));
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </Field>
                <details className="advanced-export">
                  <summary>고급 설정</summary>
                  <Field label="비트레이트 (Mbps)">
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={bitrate}
                      onChange={(e) => {
                        setQuality('custom');
                        setBitrate(Math.max(1, Math.min(30, Number(e.target.value) || 1)));
                      }}
                    />
                  </Field>
                </details>
              </>
            ) : null}
            <p className="export-note">
              화면 비율·해상도·FPS는 오른쪽 프로젝트 설정에서 변경하세요. 실제 인코더를 확인한
              형식만 선택할 수 있습니다.
            </p>
            {!caps ? (
              <p className="checking">
                <LoaderCircle size={14} className="spin" /> 현재 환경의 인코더 확인 중
              </p>
            ) : null}
            {missing.length ? (
              <p className="warning">
                <TriangleAlert size={16} /> 원본 누락: {missing.map((a) => a.name).join(', ')}. 먼저
                재연결하세요.
              </p>
            ) : null}
            {length > 300 ? <p className="warning">현재 내보내기 길이는 5분까지입니다.</p> : null}
          </>
        ) : null}
        {status === 'running' ? (
          <div className="export-progress">
            <LoaderCircle className="spin" size={30} />
            <strong>{stage}</strong>
            <progress max={1} value={progress} />
            <span>{Math.round(progress * 100)}% · 처리 프레임 기준</span>
            <p>탭을 닫지 마세요. 편집 내용은 이 출력 작업과 별도로 보존됩니다.</p>
          </div>
        ) : null}
        {status === 'done' && blob ? (
          <div className="export-success">
            <CheckCircle2 size={42} />
            <h3>내보내기가 완료됐습니다.</h3>
            <p>
              {formatBytes(blob.size)} · {format.toUpperCase()}
            </p>
            {format === 'mp4' || format === 'webm' ? (
              <video className="output-player" controls src={outputUrl} />
            ) : null}
          </div>
        ) : null}
        {status === 'error' ? (
          <p role="alert" className="warning">
            {error}
          </p>
        ) : null}
        {status === 'cancelled' ? (
          <p role="status" className="small-note">
            {stage}
          </p>
        ) : null}
        <div className="modal-actions">
          {status === 'running' ? (
            <button className="secondary full" onClick={cancel}>
              내보내기 취소
            </button>
          ) : status === 'done' && blob ? (
            <>
              <button className="secondary" onClick={onClose}>
                편집으로 돌아가기
              </button>
              <button
                className="primary"
                onClick={() => download(blob, `${filename.trim() || 'CyanCut'}.${format}`)}
              >
                <Download size={16} /> 파일 다운로드
              </button>
            </>
          ) : (
            <>
              <button className="secondary" onClick={onClose}>
                돌아가기
              </button>
              <button className="primary" disabled={!canExport} onClick={start}>
                {status === 'error' ? '다시 시도' : '내보내기'} <ArrowRight size={16} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
