import { PROJECT_MAX_DIMENSION, type Project } from './model';

/** Explicit dimensions avoid intrinsic-size loops under CSS size containment. */
export function fitPreview(width: number, height: number, aspect: number) {
  const w = Math.max(1, Math.min(Math.max(1, width), Math.max(1, height) * aspect));
  return { width: w, height: Math.min(Math.max(1, height), w / aspect) };
}

export const ratios = {
  '16:9': [16, 9],
  '9:16': [9, 16],
  '1:1': [1, 1],
  '4:5': [4, 5],
  '4:3': [4, 3],
} as const;
export function setRatio(p: Project, ratio: keyof typeof ratios, resolution: number) {
  const [a, b] = ratios[ratio];
  const unit = Math.min(resolution / Math.min(a, b), PROJECT_MAX_DIMENSION / Math.max(a, b));
  return { ...p, width: Math.round((unit * a) / 2) * 2, height: Math.round((unit * b) / 2) * 2 };
}
export function ratioOf(p: Project) {
  return (
    (Object.keys(ratios) as (keyof typeof ratios)[]).find(
      (k) => Math.abs(p.width / p.height - ratios[k][0] / ratios[k][1]) < 0.005,
    ) ?? '사용자 지정'
  );
}
