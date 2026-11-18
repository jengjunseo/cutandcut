import type { TextStyle } from './model';
import { fontCatalog } from './fonts';
type Context = OffscreenCanvasRenderingContext2D;
const segmenter = new Intl.Segmenter('ko', { granularity: 'grapheme' });
export const graphemes = (s: string) => Array.from(segmenter.segment(s), (v) => v.segment);
type Layout = {
  lines: { text: string; width: number }[];
  width: number;
  height: number;
  lineHeight: number;
};
const cache = new Map<string, Layout>();
function layout(ctx: Context, t: TextStyle, ratio: number): Layout {
  const spacing = (t.letterSpacing ?? 0) * ratio,
    max = (t.boxWidth ?? 0) * ratio;
  const key = JSON.stringify([ctx.font, t.text, t.lineHeight, t.letterSpacing, max]);
  const hit = cache.get(key);
  if (hit) return hit;
  const width = (s: string) =>
    ctx.measureText(s).width + Math.max(0, graphemes(s).length - 1) * spacing;
  const lines: { text: string; width: number }[] = [];
  for (const raw of t.text.split('\n')) {
    if (!max) {
      lines.push({ text: raw, width: width(raw) });
      continue;
    }
    let line = '';
    for (const glyph of graphemes(raw)) {
      if (line && width(line + glyph) > max) {
        lines.push({ text: line, width: width(line) });
        line = '';
      }
      line += glyph;
    }
    lines.push({ text: line, width: width(line) });
  }
  const lineHeight = t.size * ratio * (t.lineHeight ?? 1.45),
    result = {
      lines,
      width: lines.reduce((w, l) => Math.max(w, l.width), 0),
      height: lines.length * lineHeight,
      lineHeight,
    };
  if (t.text.length <= 16000) {
    if (cache.size >= 64) cache.delete(cache.keys().next().value!);
    cache.set(key, result);
  }
  return result;
}
function rounded(ctx: Context, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();
}
export function drawStyledText(ctx: Context, t: TextStyle, ratio: number) {
  if (!t.text) return;
  const size = t.size * ratio,
    family = fontCatalog.find((f) => f.id === (t.fontId ?? 'noto'))?.family ?? 'CyanCut Noto';
  ctx.font = `${t.bold ? 700 : 400} ${size}px "${family}"`;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.textAlign = t.align;
  const l = layout(ctx, t, ratio),
    alpha = ctx.globalAlpha;
  const parts = t.anchor?.split('-'),
    ax = parts?.[1] ?? t.align,
    ay = parts?.[0] ?? 'middle';
  const left = ax === 'left' ? 0 : ax === 'right' ? -l.width : -l.width / 2,
    top = ay === 'top' ? 0 : ay === 'bottom' ? -l.height : -l.height / 2;
  const x = t.anchor
    ? left + (t.align === 'left' ? 0 : t.align === 'right' ? l.width : l.width / 2)
    : 0;
  const bg = t.backgroundStyle,
    px = (bg?.paddingX ?? t.size * 0.3) * ratio,
    py = (bg?.paddingY ?? 0) * ratio;
  const background = (x: number, y: number, w: number, h: number) => {
    ctx.globalAlpha = alpha * (bg?.alpha ?? 1);
    ctx.fillStyle = t.background;
    rounded(ctx, x - px, y - py, w + px * 2, h + py * 2, (bg?.radius ?? 0) * ratio);
    ctx.globalAlpha = alpha;
  };
  if (t.background !== 'transparent' && bg?.policy === 'block')
    background(left, top, l.width, l.height);
  const write = (value: string, x: number, y: number, stroke: boolean) => {
    const spacing = (t.letterSpacing ?? 0) * ratio;
    if (!spacing) {
      if (stroke) ctx.strokeText(value, x, y);
      else ctx.fillText(value, x, y);
      return;
    }
    const glyphs = graphemes(value),
      w = ctx.measureText(value).width + Math.max(0, glyphs.length - 1) * spacing;
    let at = x - (t.align === 'center' ? w / 2 : t.align === 'right' ? w : 0);
    ctx.textAlign = 'left';
    for (const glyph of glyphs) {
      if (stroke) ctx.strokeText(glyph, at, y);
      else ctx.fillText(glyph, at, y);
      at += ctx.measureText(glyph).width + spacing;
    }
    ctx.textAlign = t.align;
  };
  for (let i = 0; i < l.lines.length; i++) {
    const line = l.lines[i],
      y = top + (i + 0.5) * l.lineHeight;
    if (t.background !== 'transparent' && bg?.policy !== 'block')
      background(
        x - (t.align === 'left' ? 0 : t.align === 'right' ? line.width : line.width / 2),
        y - l.lineHeight / 2,
        line.width,
        l.lineHeight,
      );
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = ctx.shadowOffsetY = 0;
    const shadow = () => {
      if (t.shadow) {
        const s = t.shadowStyle;
        ctx.shadowColor = s ? s.color : 'rgba(0,0,0,.65)';
        ctx.shadowBlur = (s?.blur ?? t.size * 0.15) * ratio;
        ctx.shadowOffsetX = (s?.x ?? 0) * ratio;
        ctx.shadowOffsetY = (s?.y ?? t.size * 0.07) * ratio;
      }
    };
    if (!t.styleVersion) shadow();
    if (t.outline) {
      ctx.strokeStyle = t.strokeColor ?? '#111820';
      ctx.lineWidth = t.outline * ratio * 2;
      ctx.globalAlpha = alpha * (t.strokeAlpha ?? 1);
      write(line.text, x, y, true);
    }
    shadow();
    ctx.globalAlpha = alpha * (t.fillAlpha ?? 1);
    ctx.fillStyle = t.color;
    // Shadow alpha is carried by the color, independent from text alpha.
    if (t.shadowStyle && t.shadow) {
      const s = t.shadowStyle;
      ctx.shadowColor = hexAlpha(s.color, s.alpha);
    }
    write(line.text, x, y, false);
    ctx.globalAlpha = alpha;
  }
  return { left, top, width: l.width, height: l.height };
}
export function hexAlpha(color: string, alpha: number) {
  return /^#[0-9a-f]{6}$/i.test(color)
    ? `${color}${Math.round(alpha * 255)
        .toString(16)
        .padStart(2, '0')}`
    : color;
}
