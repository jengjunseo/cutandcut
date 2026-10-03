import { layers, type Project, type Clip } from './model';
import { MediaPool, VideoCursor } from './media';
import { ensureFonts } from './fonts';
export class Renderer {
  cursors = new Map<string, VideoCursor>();
  fontText = '';
  constructor(
    public pool: MediaPool,
    public canvas: OffscreenCanvas,
  ) {}
  async render(p: Project, time: number) {
    const texts = p.clips.map((c) => c.text?.text ?? '').join('');
    if (texts !== this.fontText) {
      await ensureFonts(texts);
      this.fontText = texts;
    }
    const ctx = this.canvas.getContext('2d')!;
    const w = this.canvas.width,
      h = this.canvas.height;
    ctx.resetTransform();
    ctx.globalAlpha = 1;
    ctx.fillStyle = p.background;
    ctx.fillRect(0, 0, w, h);
    const visible = layers(p, time);
    const active = new Set(
      visible.filter((layer) => layer.clip.kind === 'video').map((layer) => layer.clip.id),
    );
    // Release previous scenes before admitting new sources into the bounded cache.
    await this.releaseInactive(active);
    for (const { clip: c, sourceTime, alpha, overlay, overlayAlpha } of visible) {
      ctx.save();
      try {
        ctx.globalAlpha = alpha;
        ctx.translate(w * c.x, h * c.y);
        ctx.rotate((c.rotation * Math.PI) / 180);
        ctx.scale(c.scale, c.scale);
        if (c.kind === 'text') drawText(ctx, c, w, p.width);
        else if (c.assetId) {
          const r = await this.pool.get(c.assetId);
          let source: CanvasImageSource | undefined = r.image;
          if (r.video) {
            let cursor = this.cursors.get(c.id);
            if (!cursor) {
              cursor = new VideoCursor(r.video, Math.max(1, Math.round(w * 1.5)), c.assetId);
              this.pool.pin(c.assetId);
              this.cursors.set(c.id, cursor);
            }
            const asset = p.assets.find((a) => a.id === c.assetId)!;
            const timestamp = (asset.origin ?? asset.videoStart) + Math.max(0, sourceTime);
            source = timestamp + 0.5e-6 < asset.videoStart ? undefined : await cursor.at(timestamp);
          }
          if (source) {
            const sw = (source as ImageBitmap | OffscreenCanvas).width,
              sh = (source as ImageBitmap | OffscreenCanvas).height;
            const crop = c.crop ?? { left: 0, right: 0, top: 0, bottom: 0 },
              cw = sw * (1 - crop.left - crop.right),
              ch = sh * (1 - crop.top - crop.bottom);
            const scale = c.fit === 'cover' ? Math.max(w / cw, h / ch) : Math.min(w / cw, h / ch);
            ctx.scale(c.flipX ? -1 : 1, c.flipY ? -1 : 1);
            ctx.drawImage(
              source,
              sw * crop.left,
              sh * crop.top,
              cw,
              ch,
              (-cw * scale) / 2,
              (-ch * scale) / 2,
              cw * scale,
              ch * scale,
            );
          }
        }
      } finally {
        ctx.restore();
      }
      if (overlay) {
        ctx.save();
        ctx.globalAlpha = (overlayAlpha ?? 0) * alpha;
        ctx.fillStyle = overlay;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }
    }
  }
  private async releaseInactive(active: Set<string>) {
    for (const [key, cursor] of this.cursors)
      if (!active.has(key)) {
        await cursor.close();
        this.pool.release(cursor.assetId);
        this.cursors.delete(key);
      }
  }
  async close() {
    await this.releaseInactive(new Set());
    this.canvas.width = this.canvas.height = 1;
  }
}
function drawText(
  ctx: OffscreenCanvasRenderingContext2D,
  c: Clip,
  w: number,
  projectWidth: number,
) {
  const t = c.text!;
  const fontSize = (t.size * w) / projectWidth;
  ctx.font = `${t.bold ? 700 : 400} ${fontSize}px "CyanCut Noto"`;
  ctx.textAlign = t.align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const lines = t.text.split('\n'),
    lineHeight = fontSize * 1.45;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const y = (i - (lines.length - 1) / 2) * lineHeight;
    const width = ctx.measureText(line).width;
    const left = t.align === 'left' ? 0 : t.align === 'right' ? -width : -width / 2;
    if (t.background !== 'transparent') {
      ctx.fillStyle = t.background;
      ctx.fillRect(left - fontSize * 0.3, y - lineHeight / 2, width + fontSize * 0.6, lineHeight);
    }
    if (t.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,.65)';
      ctx.shadowBlur = fontSize * 0.15;
      ctx.shadowOffsetY = fontSize * 0.07;
    }
    if (t.outline) {
      ctx.strokeStyle = '#111820';
      ctx.lineWidth = ((t.outline * w) / projectWidth) * 2;
      ctx.strokeText(line, 0, y);
    }
    ctx.fillStyle = t.color;
    ctx.fillText(line, 0, y);
  }
}
