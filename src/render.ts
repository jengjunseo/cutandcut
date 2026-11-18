import { layers, type Project } from './model';
import { MediaPool, VideoCursor } from './media';
import { ensureFonts } from './fonts';
import { VIDEO_CONTEXT } from './color';
import { ExportMetrics } from './export-metrics';
import { drawStyledText } from './text-layout';
export class Renderer {
  measureSelection = false;
  textBounds: Record<string, { left: number; top: number; width: number; height: number }> = {};
  blendCanvas?: OffscreenCanvas;
  cursors = new Map<string, VideoCursor>();
  fontText = '';
  prepared?: Project;
  constructor(
    public pool: MediaPool,
    public canvas: OffscreenCanvas,
    public metrics = new ExportMetrics(),
  ) {}
  async render(p: Project, time: number) {
    if (p !== this.prepared) {
      const signature = p.clips
        .map((c) => (c.text ? JSON.stringify([c.text.text, c.text.fontId, c.text.bold]) : ''))
        .join('');
      if (signature !== this.fontText) {
        await Promise.all(
          p.clips
            .filter((c) => c.text?.text)
            .map((c) => ensureFonts(c.text!.text, c.text!.fontId, c.text!.bold ? 700 : 400)),
        );
        this.fontText = signature;
      }
      this.prepared = p;
    }
    const ctx = this.canvas.getContext('2d', VIDEO_CONTEXT);
    if (!ctx) throw new Error('SDR 영상 합성 캔버스를 시작할 수 없습니다.');
    const w = this.canvas.width,
      h = this.canvas.height;
    this.textBounds = {};
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
    const main = ctx;
    for (let index = 0; index < visible.length; index++) {
      const {
        clip: c,
        sourceTime,
        alpha,
        overlay,
        overlayAlpha,
        blendGroup,
        mask,
        offsetX = 0,
        offsetY = 0,
      } = visible[index];
      let ctx = main;
      if (blendGroup) {
        this.blendCanvas ??= new OffscreenCanvas(w, h);
        ctx = this.blendCanvas.getContext('2d', { colorSpace: 'srgb', alpha: true })!;
        if (visible[index - 1]?.blendGroup !== blendGroup) ctx.clearRect(0, 0, w, h);
      }
      ctx.save();
      try {
        if (blendGroup) ctx.globalCompositeOperation = 'lighter';
        if (mask) {
          const x = Math.round(mask.x * w),
            y = Math.round(mask.y * h);
          ctx.beginPath();
          ctx.rect(
            x,
            y,
            Math.round((mask.x + mask.w) * w) - x,
            Math.round((mask.y + mask.h) * h) - y,
          );
          ctx.clip();
        }
        ctx.globalAlpha = alpha;
        ctx.translate(w * (c.x + offsetX), h * (c.y + offsetY));
        ctx.rotate((c.rotation * Math.PI) / 180);
        ctx.scale(c.scale, c.scale);
        if (c.kind === 'text') {
          const bounds = drawStyledText(ctx, c.text!, w / p.width);
          if (bounds && this.measureSelection)
            this.textBounds[c.id] = {
              left: bounds.left / w,
              top: bounds.top / h,
              width: bounds.width / w,
              height: bounds.height / h,
            };
        } else if (c.assetId) {
          const r = await this.metrics.measure('demux/resource', () => this.pool.get(c.assetId!));
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
            source =
              timestamp + 0.5e-6 < asset.videoStart
                ? undefined
                : await this.metrics.measure('video decode', () => cursor!.at(timestamp));
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
      if (blendGroup && visible[index + 1]?.blendGroup !== blendGroup)
        main.drawImage(this.blendCanvas!, 0, 0);
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
    let failure: unknown;
    for (const [key, cursor] of this.cursors)
      if (!active.has(key)) {
        try {
          await cursor.close();
        } catch (error) {
          failure ??= error;
        } finally {
          this.pool.release(cursor.assetId);
          this.cursors.delete(key);
        }
      }
    if (failure) throw failure;
  }
  async close() {
    try {
      await this.releaseInactive(new Set());
    } finally {
      this.textBounds = {};
      this.canvas.width = this.canvas.height = 1;
      if (this.blendCanvas) this.blendCanvas.width = this.blendCanvas.height = 1;
    }
  }
}
