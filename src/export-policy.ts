export type ExportFormat = 'mp4' | 'webm' | 'wav' | 'mp3';
export const EXPORT_MAX_BYTES = 1024 * 1024 * 1024;
export const EXPORT_MAX_SECONDS = 30 * 60;
export const EXPORT_LIMIT_LABEL = '30분·1GiB';
/** Same frame rounding, audio bitrate and container reserve in UI and Worker. */
export function exportBudget(format: ExportFormat, length: number, fps: number, bitrate: number) {
  const video = format === 'mp4' || format === 'webm';
  const bytesPerSecond =
    format === 'wav' ? 48000 * 4 : format === 'mp3' ? 192000 / 8 : (bitrate + 192000) / 8;
  const reserve = 65536;
  const maximum = Math.min(EXPORT_MAX_SECONDS, (EXPORT_MAX_BYTES - reserve - 1) / bytesPerSecond);
  const maxSeconds = video ? Math.floor(maximum * fps) / fps : Math.floor(maximum * 48000) / 48000;
  const outputSeconds = video ? Math.ceil(length * fps) / fps : Math.ceil(length * 48000) / 48000;
  const estimate = Math.ceil(outputSeconds * bytesPerSecond) + reserve;
  return {
    maxSeconds,
    estimate,
    allowed: length > 0 && length <= EXPORT_MAX_SECONDS && estimate < EXPORT_MAX_BYTES,
  };
}
