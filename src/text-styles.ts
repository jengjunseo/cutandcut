import type { TextStyle } from './model';
export type Style = Omit<TextStyle, 'text'>;
const base: Style = {
  fontId: 'noto',
  styleVersion: 2,
  size: 48,
  color: '#ffffff',
  fillAlpha: 1,
  bold: false,
  align: 'center',
  outline: 2,
  strokeColor: '#111820',
  strokeAlpha: 1,
  shadow: false,
  shadowStyle: { color: '#000000', alpha: 0.65, x: 0, y: 3, blur: 7 },
  background: 'transparent',
  backgroundStyle: { alpha: 0.7, paddingX: 16, paddingY: 8, radius: 8, policy: 'block' },
  lineHeight: 1.3,
  letterSpacing: 0,
  boxWidth: 1500,
  anchor: 'middle-center',
};
export const textPresets: { id: string; name: string; style: Style }[] = [
  { id: 'white', name: '기본 흰색 + 검정 외곽선', style: { ...base } },
  {
    id: 'bold',
    name: '굵은 강조',
    style: { ...base, bold: true, size: 64, color: '#ffe55c', outline: 3 },
  },
  { id: 'box', name: '반투명 검정 박스', style: { ...base, outline: 0, background: '#000000' } },
  {
    id: 'name',
    name: '이름표',
    style: {
      ...base,
      fontId: 'gothic',
      size: 38,
      bold: true,
      outline: 0,
      background: '#237f8c',
      backgroundStyle: { ...base.backgroundStyle!, alpha: 0.95, paddingX: 24, radius: 6 },
    },
  },
  {
    id: 'title',
    name: '제목',
    style: { ...base, fontId: 'myeongjo', size: 92, bold: true, outline: 0, shadow: true },
  },
  {
    id: 'shorts',
    name: '쇼츠 하단 자막',
    style: { ...base, size: 64, bold: true, boxWidth: 820, outline: 3, shadow: true },
  },
];
export function styleSnapshot(t: TextStyle): Style {
  const { text: _, ...style } = t;
  return structuredClone(style);
}
export function validTextStyle(t: TextStyle) {
  const finite = (v: unknown, min: number, max: number) =>
    v === undefined || (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max);
  if (
    !t ||
    typeof t !== 'object' ||
    typeof t.size !== 'number' ||
    !finite(t.size, 1, 10000) ||
    typeof t.color !== 'string' ||
    typeof t.bold !== 'boolean' ||
    !['left', 'center', 'right'].includes(t.align) ||
    typeof t.outline !== 'number' ||
    !finite(t.outline, 0, 1000) ||
    typeof t.shadow !== 'boolean' ||
    typeof t.background !== 'string'
  )
    return false;
  if (t.fontId !== undefined && !['noto', 'gothic', 'myeongjo'].includes(t.fontId)) return false;
  if (t.styleVersion !== undefined && t.styleVersion !== 2) return false;
  if (
    !finite(t.lineHeight, 0.5, 5) ||
    !finite(t.letterSpacing, -100, 200) ||
    !finite(t.boxWidth, 0, 100000) ||
    !finite(t.fillAlpha, 0, 1) ||
    !finite(t.strokeAlpha, 0, 1)
  )
    return false;
  if (t.strokeColor !== undefined && typeof t.strokeColor !== 'string') return false;
  if (t.anchor !== undefined && !/^(top|middle|bottom)-(left|center|right)$/.test(t.anchor))
    return false;
  const s = t.shadowStyle,
    b = t.backgroundStyle;
  if (
    s !== undefined &&
    (!s ||
      typeof s !== 'object' ||
      typeof s.color !== 'string' ||
      ![s.alpha, s.x, s.y, s.blur].every((v) => typeof v === 'number') ||
      !finite(s.alpha, 0, 1) ||
      !finite(s.x, -10000, 10000) ||
      !finite(s.y, -10000, 10000) ||
      !finite(s.blur, 0, 1000))
  )
    return false;
  if (
    b !== undefined &&
    (!b ||
      typeof b !== 'object' ||
      ![b.alpha, b.paddingX, b.paddingY, b.radius].every((v) => typeof v === 'number') ||
      !finite(b.alpha, 0, 1) ||
      !finite(b.paddingX, 0, 10000) ||
      !finite(b.paddingY, 0, 10000) ||
      !finite(b.radius, 0, 10000) ||
      !['line', 'block'].includes(b.policy))
  )
    return false;
  return true;
}
