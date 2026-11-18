/** Opt-in local measurements. No media, names, text or paths are recorded or transmitted. */
export class ExportMetrics {
  totals: Record<string, number> = {};
  calls: Record<string, number> = {};
  started = performance.now();
  peakVideoQueue = 0;
  encodedVideoPackets = 0;
  constructor(public enabled = false) {}
  async measure<T>(stage: string, work: () => Promise<T>): Promise<T> {
    if (!this.enabled) return work();
    const start = performance.now();
    try {
      return await work();
    } finally {
      this.totals[stage] = (this.totals[stage] ?? 0) + performance.now() - start;
      this.calls[stage] = (this.calls[stage] ?? 0) + 1;
    }
  }
  watchVideoQueue() {
    if (!this.enabled || typeof VideoEncoder === 'undefined') return () => {};
    const original = VideoEncoder.prototype.encode,
      metrics = this;
    VideoEncoder.prototype.encode = function (frame, options) {
      original.call(this, frame, options);
      metrics.peakVideoQueue = Math.max(metrics.peakVideoQueue, this.encodeQueueSize);
    };
    return () => {
      VideoEncoder.prototype.encode = original;
    };
  }
  result() {
    return this.enabled
      ? {
          wallMs: performance.now() - this.started,
          stagesMs: this.totals,
          calls: this.calls,
          peakVideoQueue: this.peakVideoQueue,
          encodedVideoPackets: this.encodedVideoPackets,
        }
      : undefined;
  }
}
