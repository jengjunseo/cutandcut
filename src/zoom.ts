export const zoomRanges = [60, 30, 15, 10, 5, 1] as const;
export function zoomScale(width: number, seconds: number) {
  return Math.max(1, width) / Math.max(0.001, seconds);
}
export function nextZoom(current: number, direction: number) {
  const all = [...zoomRanges];
  return direction > 0
    ? (all.find((v) => v < current - 0.001) ?? 1)
    : ([...all].reverse().find((v) => v > current + 0.001) ?? 60);
}
