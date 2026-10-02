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
export function request<T>(type: string, data: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    jobs.push({
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
          type === 'waveform' ? 120000 : 60000,
        );
        function finish(error?: Error, value?: T) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          worker.terminate();
          active--;
          if (type === 'waveform') activeWaveforms--;
          if (error) reject(error);
          else resolve(value!);
          pump();
        }
        worker.onmessage = (event) => {
          if (event.data.requestId !== rid) return;
          if (event.data.type === 'error') finish(new Error(event.data.error));
          else finish(undefined, event.data.asset ?? event.data.peaks ?? event.data.value);
        };
        worker.onerror = (e) => finish(new Error(e.message));
        worker.postMessage({ type, requestId: rid, ...data });
      },
    });
    pump();
  });
}
export const inspect = (file: File) => request<Asset>('probe', { file });
export type Capabilities = {
  mp4: boolean;
  webm: boolean;
  wav: boolean;
  mp3: boolean;
  vp9: boolean;
};
export const checkCapabilities = (project: Project, bitrate: number) =>
  request<Capabilities>('capabilities', { project, bitrate });
