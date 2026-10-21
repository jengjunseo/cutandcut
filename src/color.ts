/** SDR working space shared by the worker compositor and its display surface.
 * Opaque surfaces match MP4/WebM output and avoid device-dependent alpha conversion.
 * Source profiles stay intact: never relabel YUV frames as RGB or overwrite their matrix.
 */
export const VIDEO_CONTEXT: CanvasRenderingContext2DSettings = { colorSpace: 'srgb', alpha: false };

export type SourceColorSpace = {
  primaries?: string | null;
  transfer?: string | null;
  matrix?: string | null;
  fullRange?: boolean | null;
};

export function validSourceColorSpace(value: unknown): value is SourceColorSpace {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const space = value as Record<string, unknown>;
  return (
    ['primaries', 'transfer', 'matrix'].every(
      (key) => space[key] == null || (typeof space[key] === 'string' && space[key].length <= 64),
    ) &&
    (space.fullRange == null || typeof space.fullRange === 'boolean')
  );
}

export function sourceColorWarning(space?: SourceColorSpace): string | undefined {
  if (!space) return;
  if (space.transfer === 'pq' || space.transfer === 'hlg')
    return 'HDR 원본입니다. SDR로 합성하며 기기별 밝기·색 변환이 다를 수 있습니다. 색이 다르면 SDR/Rec.709로 변환한 원본을 사용하세요.';
  if (
    space.primaries === 'bt2020' ||
    space.primaries === 'smpte432' ||
    space.matrix === 'bt2020-ncl'
  )
    return '넓은 색역 원본입니다. SDR(sRGB)로 합성하므로 원본의 색 범위를 모두 유지하지 않습니다. 기기 간 색이 다르면 SDR/Rec.709 원본을 사용하세요.';
}
