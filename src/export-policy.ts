export type ExportFormat = 'mp4' | 'webm' | 'wav' | 'mp3';
/** Same frame rounding, audio bitrate and container reserve in UI and Worker. */
export function exportBudget(format: ExportFormat, length: number, fps: number, bitrate: number) {
  const video = format === 'mp4' || format === 'webm';
  const bytesPerSecond =
    format === 'wav' ? 48000 * 4 : format === 'mp3' ? 192000 / 8 : (bitrate + 192000) / 8;
  const reserve = 65536;
  const outputSeconds = video ? Math.ceil(length * fps) / fps : Math.ceil(length * 48000) / 48000;
  const estimate = Math.ceil(outputSeconds * bytesPerSecond) + reserve;
  return {
    estimate,
    allowed:
      Number.isFinite(length) &&
      length > 0 &&
      Number.isSafeInteger(estimate) &&
      Number.isSafeInteger(Math.ceil(length * 48000)) &&
      Number.isFinite(bitrate) &&
      bitrate > 0 &&
      Number.isFinite(fps) &&
      fps > 0,
  };
}
