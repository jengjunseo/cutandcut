import EngineWorker from './engine.worker?worker';
import type { Asset, Project } from './model';
export const files = new Map<string, File>();
let requestId = 0;
export function createEngine() {
  return new EngineWorker();
}
type Job = { type: string; run: () => void };
const jobs: Job[] = [];
let active = 0,
  activeWaveforms = 0;
function pump() {
  while (active < 2) {
    let index = jobs.findIndex((j) => j.type !== 'waveform');
    if (index < 0) {
      if (activeWaveforms) return;
      index = jobs.findIndex((j) => j.type === 'waveform');
    }
    if (index < 0) return;
    const [job] = jobs.splice(index, 1);
    active++;
    if (job.type === 'waveform') activeWaveforms++;
    job.run();
  }
}
export function request<T>(
  type: string,
  data: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('작업을 취소했습니다.', 'AbortError'));
      return;
    }
    let abort = () => {
      const at = jobs.indexOf(job);
      if (at >= 0) {
        jobs.splice(at, 1);
        signal?.removeEventListener('abort', cancel);
        reject(new DOMException('작업을 취소했습니다.', 'AbortError'));
      }
    };
    const cancel = () => abort();
    const job: Job = {
      type,
      run: () => {
        const worker = createEngine(),
          rid = ++requestId;
        let settled = false;
        const timer = setTimeout(
          () =>
            finish(
              new Error(
                '미디어 분석이 시간 제한을 초과했습니다. 더 짧은 파일이나 변환한 파일을 사용하세요.',
              ),
            ),
          type === 'waveform' || type === 'audio-analysis' ? 120000 : 60000,
        );
        function finish(error?: Error, value?: T) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener('abort', cancel);
          worker.terminate();
          active--;
          if (type === 'waveform') activeWaveforms--;
          if (error) reject(error);
          else resolve(value!);
          pump();
        }
        abort = () => finish(new DOMException('작업을 취소했습니다.', 'AbortError'));
        worker.onmessage = (event) => {
          if (event.data.requestId !== rid) return;
          if (event.data.type === 'error') finish(new Error(event.data.error));
          else finish(undefined, event.data.asset ?? event.data.peaks ?? event.data.value);
        };
        worker.onerror = (e) => finish(new Error(e.message));
        worker.postMessage({ type, requestId: rid, ...data });
      },
    };
    jobs.push(job);
    signal?.addEventListener('abort', cancel, { once: true });
    pump();
  });
}
export const inspect = (file: File, signal?: AbortSignal) =>
  request<Asset>('probe', { file }, signal);
export type Capabilities = {
  mp4: boolean;
  webm: boolean;
  wav: boolean;
  mp3: boolean;
  vp9: boolean;
  aacFallback?: boolean;
  avc?: boolean;
};
const capabilityCache = new Map<string, Promise<Capabilities>>();
export function checkCapabilities(project: Project, bitrate: number) {
  const key = `${project.width}:${project.height}:${project.fps}:${bitrate}`;
  if (!capabilityCache.has(key)) {
    if (capabilityCache.size >= 12) capabilityCache.delete(capabilityCache.keys().next().value!);
    capabilityCache.set(
      key,
      request<Capabilities>('capabilities', { project, bitrate }).catch((e) => {
        capabilityCache.delete(key);
        throw e;
      }),
    );
  }
  return capabilityCache.get(key)!;
}
