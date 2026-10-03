import { audioGain, activeTracks, seconds, type Project } from './model';
import { files } from './engine';
type Playing = {
  element: HTMLAudioElement;
  gain: GainNode;
  source: MediaElementAudioSourceNode;
  url: string;
};
export class AudioPreview {
  context?: AudioContext;
  analyser?: AnalyserNode;
  playing = new Map<string, Playing>();
  async resume() {
    this.context ??= new AudioContext();
    if (!this.analyser) {
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.connect(this.context.destination);
    }
    await this.context.resume();
  }
  sync(p: Project, time: number, playing: boolean, rate: number) {
    if (!this.context) return;
    const audible = activeTracks(p, 'audio');
    const active = p.clips.filter(
      (c) =>
        c.kind === 'audio' &&
        time >= c.start &&
        time < c.start + c.duration &&
        audible.has(c.trackId) &&
        playing &&
        rate > 0,
    );
    const ids = new Set(active.map((c) => c.id));
    for (const [key, value] of this.playing)
      if (!ids.has(key)) {
        this.release(value);
        this.playing.delete(key);
      }
    for (const c of active) {
      const file = files.get(c.assetId!);
      if (!file) continue;
      let a = this.playing.get(c.id);
      if (!a) {
        const element = new Audio();
        const url = URL.createObjectURL(file);
        element.src = url;
        element.preload = 'auto';
        const source = this.context.createMediaElementSource(element);
        const gain = this.context.createGain();
        source.connect(gain).connect(this.analyser!);
        a = { element, gain, source, url };
        this.playing.set(c.id, a);
      }
      const asset = p.assets.find((a) => a.id === c.assetId);
      const target =
        seconds(c.sourceIn + (time - c.start) * (c.speed ?? 1)) +
        (asset?.origin ?? asset?.audioStart ?? 0);
      if (Math.abs(a.element.currentTime - target) > 0.18)
        a.element.currentTime = Math.max(0, target);
      a.element.playbackRate = Math.min(16, rate * (c.speed ?? 1));
      a.element.preservesPitch = c.preservePitch !== false;
      a.gain.gain.setTargetAtTime(
        audioGain(c, time) * (p.masterVolume ?? 1),
        this.context.currentTime,
        0.015,
      );
      if (a.element.paused) void a.element.play().catch(() => {});
    }
  }
  stop() {
    for (const a of this.playing.values()) this.release(a);
    this.playing.clear();
  }
  private release(a: Playing) {
    a.element.pause();
    a.source.disconnect();
    a.gain.disconnect();
    a.element.removeAttribute('src');
    a.element.load();
    URL.revokeObjectURL(a.url);
  }
  close() {
    this.stop();
    this.analyser?.disconnect();
    void this.context?.close();
  }
}
