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
import { duration, seconds, requiredAssets, type Project } from './model';
import { checkCapabilities, createEngine, files, type Capabilities } from './engine';
import { download } from './storage';
import { Field, IconButton, formatBytes } from './ui';
import { ratioOf, setRatio, ratios } from './Inspector';
import { exportBudget } from './export-policy';
type Props = {
  project: Project;
  onClose: () => void;
  range?: { start: number; end: number };
};
export default function ExportDialog({ project, onClose, range }: Props) {
  const [snapshot, setSnapshot] = useState(() => structuredClone(project));
  const [settingsOpen, setSettingsOpen] = useState(false),
    [useRange, setUseRange] = useState(false),
    [largePlayer, setLargePlayer] = useState(false);
  function settings(p: Project) {
    setSnapshot(p);
  }
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
  const [audioStats, setAudioStats] = useState<{ peak: number; clippedSamples: number }>();
  const from = useRange && range ? range.start : 0;
  const to = useRange && range ? Math.min(duration(snapshot), range.end) : duration(snapshot);
  const visible = snapshot.clips.filter(
    (c) =>
      c.start < to &&
      c.start + c.duration > from &&
      !snapshot.tracks.find((t) => t.id === c.trackId)?.hidden,
  );
  const needed = requiredAssets(snapshot, from, to, format === 'mp4' || format === 'webm');
  const missing = snapshot.assets.filter((a) => needed.has(a.id) && !files.has(a.id));
  const visualIntervals = visible
    .filter((c) => c.kind !== 'audio')
    .map((c) => [Math.max(from, c.start), Math.min(to, c.start + c.duration)])
    .sort((a, b) => a[0] - b[0]);
  let covered = from,
    gaps = 0;
  for (const [start, end] of visualIntervals) {
    if (start > covered) gaps += start - covered;
    covered = Math.max(covered, end);
  }
  gaps += Math.max(0, to - covered);
  const riskyText = visible.filter(
    (c) =>
      c.text &&
      (c.y < 0.05 ||
        c.y > 0.95 ||
        Math.max(...c.text.text.split('\n').map((s) => s.length)) * c.text.size * c.scale >
          snapshot.width * 0.95),
  );
  const overlaps = snapshot.tracks
    .filter((t) => t.kind === 'visual')
    .filter((t) => {
      const clips = visible.filter((c) => c.trackId === t.id).sort((a, b) => a.start - b.start);
      return clips.some((c, i) => i > 0 && c.start < clips[i - 1].start + clips[i - 1].duration);
    });
  const length = seconds(to - from);
  const budget = exportBudget(format, length, snapshot.fps, bitrate * 1e6);
  const estimate = budget.estimate;
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
  }, [snapshot.width, snapshot.height, snapshot.fps, bitrate]);
  useEffect(() => {
    const old = document.activeElement as HTMLElement;
    dialog.current?.focus();
    return () => {
      worker.current?.terminate();
      old?.focus();
    };
  }, []);
  function start() {
    if (worker.current || !canExport) return;
    setStatus('running');
    setError('');
    setBlob(null);
    setAudioStats(undefined);
    setProgress(0);
    setStage('엔진 시작');
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
        setAudioStats(d.audio);
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
    w.postMessage({
      type: 'export',
      project: snapshot,
      format,
      bitrate: bitrate * 1e6,
      range: { start: from, end: to },
    });
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
  const canExport = !!caps?.[format] && !missing.length && budget.allowed;
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
          {status !== 'running' && status !== 'done' ? (
            <button
              className="secondary"
              onClick={() => setSettingsOpen(!settingsOpen)}
              aria-expanded={settingsOpen}
            >
              출력 설정 변경
            </button>
          ) : null}
        </div>
        {status !== 'running' && status !== 'done' ? (
          <>
            {settingsOpen ? (
              <fieldset className="export-settings">
                <legend>이번 출력에만 적용 · 편집 프로젝트는 유지</legend>
                <Field label="출력 화면 비율">
                  <select
                    value={ratioOf(snapshot)}
                    onChange={(e) =>
                      settings(
                        setRatio(
                          snapshot,
                          e.target.value as keyof typeof ratios,
                          Math.min(snapshot.width, snapshot.height),
                        ),
                      )
                    }
                  >
                    {Object.keys(ratios).map((key) => (
                      <option key={key}>{key}</option>
                    ))}
                    <option value="사용자 지정" disabled>
                      사용자 지정
                    </option>
                  </select>
                </Field>
                <Field label="출력 해상도">
                  <select
                    value={Math.min(snapshot.width, snapshot.height) >= 1080 ? 1080 : 720}
                    onChange={(e) =>
                      settings(
                        setRatio(
                          snapshot,
                          ratioOf(snapshot) === '사용자 지정'
                            ? '16:9'
                            : (ratioOf(snapshot) as keyof typeof ratios),
                          Number(e.target.value),
                        ),
                      )
                    }
                  >
                    <option value={720}>720p</option>
                    <option value={1080}>1080p</option>
                  </select>
                </Field>
                <Field label="출력 FPS">
                  <select
                    value={snapshot.fps}
                    onChange={(e) => settings({ ...snapshot, fps: Number(e.target.value) })}
                  >
                    {[24, 25, 30, 50, 60].map((fps) => (
                      <option key={fps}>{fps}</option>
                    ))}
                  </select>
                </Field>
              </fieldset>
            ) : null}
            {range && range.end > range.start ? (
              <Field label="출력 범위">
                <select
                  value={useRange ? 'range' : 'all'}
                  onChange={(e) => setUseRange(e.target.value === 'range')}
                >
                  <option value="all">프로젝트 전체</option>
                  <option value="range">
                    I/O 선택 구간 · {seconds(range.start).toFixed(2)}–
                    {seconds(range.end).toFixed(2)}초
                  </option>
                </select>
              </Field>
            ) : null}
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
                <fieldset className="quality-field">
                  <legend>품질</legend>
                  <div className="segmented" role="radiogroup" aria-label="출력 품질">
                    {[
                      ['low', '낮음', 3],
                      ['standard', '표준', 8],
                      ['high', '높음', 16],
                    ].map(([key, label, value]) => (
                      <label key={key} className={quality === key ? 'selected' : ''}>
                        <input
                          type="radio"
                          name="output-quality"
                          value={key}
                          checked={quality === key}
                          onChange={() => {
                            setQuality(String(key));
                            setBitrate(Number(value));
                          }}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </fieldset>
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
              예상 파일 크기 약 {formatBytes(estimate)}. 현재 설정 최대 길이{' '}
              {Math.floor(budget.maxSeconds / 60)}분 {Math.floor(budget.maxSeconds % 60)}초
              (5분·256MiB 중 먼저 도달하는 제한). 출력 설정은 이번 파일에만 적용됩니다. 프로젝트
              타임라인은 60분까지입니다.
            </p>
            {caps?.aacFallback && format === 'mp4' ? (
              <p className="export-note">
                브라우저 AAC 인코더 대신 기기 안에서 WASM AAC 인코더를 사용합니다. 원본은 업로드되지
                않습니다.
              </p>
            ) : null}
            {caps?.errors &&
              Object.entries(caps.errors).map(([key, value]) => (
                <p className="export-note" key={key}>
                  {key.toUpperCase()} 인코더 확인 실패: {value}. 다른 형식은 별도로 사용할 수
                  있습니다.
                </p>
              ))}
            {estimate >= 256 * 1024 * 1024 ? (
              <p className="warning">
                예상 파일이 256MB 제한을 초과합니다. 범위나 비트레이트를 줄이세요.
              </p>
            ) : null}
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
            <details className="export-preflight">
              <summary>
                출력 사전 검사{' '}
                {missing.length +
                Number(gaps > 0) +
                Number(riskyText.length > 0) +
                Number(overlaps.length > 0)
                  ? '· 확인할 항목 있음'
                  : '· 확인 완료'}
              </summary>
              {gaps > 0 ? (
                <p>
                  영상 레이어가 없는 구간 {seconds(gaps).toFixed(2)}초는 캔버스 배경으로 출력됩니다.
                </p>
              ) : null}
              {overlaps.length ? (
                <p>
                  동일 트랙 중첩: {overlaps.map((t) => t.name).join(', ')}. 뒤에서 시작한 클립이
                  먼저 표시됩니다.
                </p>
              ) : null}
              {riskyText.length ? (
                <p>
                  화면 밖이거나 폭이 큰 텍스트: {riskyText.map((c) => c.name).join(', ')}.
                  미리보기에서 위치·줄바꿈을 확인하세요 (대략적인 검사).
                </p>
              ) : null}
              <p>
                폰트는 출력 전에 실제 로딩을 기다립니다. 영상·오디오 길이는 출력 FPS에 맞춰 마지막
                프레임까지 확장될 수 있습니다.
              </p>
            </details>
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
            {audioStats && audioStats.clippedSamples > 0 ? (
              <p className="warning">
                오디오 클리핑 {audioStats.clippedSamples}개 샘플 · 원본 믹스 피크{' '}
                {(20 * Math.log10(audioStats.peak)).toFixed(1)} dBFS. 편집으로 돌아가 프로젝트
                메뉴의 전체 음량 검사를 적용하세요.
              </p>
            ) : null}
            {format === 'mp4' || format === 'webm' ? (
              <>
                <video
                  className={`output-player ${largePlayer ? 'large' : ''}`}
                  style={{
                    aspectRatio: `${snapshot.width}/${snapshot.height}`,
                    width: `min(100%, ${(((largePlayer ? 70 : 45) * snapshot.width) / snapshot.height).toFixed(2)}vh)`,
                  }}
                  controls
                  src={outputUrl}
                />
                <button
                  className="secondary"
                  onClick={() => setLargePlayer(!largePlayer)}
                  aria-pressed={largePlayer}
                >
                  {largePlayer ? '결과 미리보기 축소' : '결과 미리보기 확대'}
                </button>
              </>
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
