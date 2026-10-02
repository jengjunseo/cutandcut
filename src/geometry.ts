/** Explicit dimensions avoid intrinsic-size loops under CSS size containment. */
export function fitPreview(width: number, height: number, aspect: number) {
  const w = Math.max(1, Math.min(Math.max(1, width), Math.max(1, height) * aspect));
  return { width: w, height: Math.min(Math.max(1, height), w / aspect) };
}
