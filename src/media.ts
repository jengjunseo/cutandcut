import {
  ALL_FORMATS,
  Input,
  BlobSource,
  CanvasSink,
  AudioSampleSink,
  type InputVideoTrack,
  type InputAudioTrack,
  type WrappedCanvas,
  type AudioSample,
} from 'mediabunny';
import { id, tick, seconds, type Asset, type Project, type Clip, audioGain } from './model';
export class MediaPool {
  files = new Map<string, File>();
  resources = new Map<
    string,
    { input: Input; video?: InputVideoTrack; audio?: InputAudioTrack; image?: ImageBitmap }
  >();
  pins = new Map<string, number>();
  pin(key: string) {
    this.pins.set(key, (this.pins.get(key) ?? 0) + 1);
  }
  release(key: string) {
    const count = (this.pins.get(key) ?? 1) - 1;
    if (count <= 0) this.pins.delete(key);
    else this.pins.set(key, count);
  }
  register(assetId: string, file: File) {
    this.files.set(assetId, file);
    const existing = this.resources.get(assetId);
    existing?.input.dispose();
    existing?.image?.close();
    this.resources.delete(assetId);
  }
  async get(assetId: string) {
    let r = this.resources.get(assetId);
    if (r) {
      this.resources.delete(assetId);
      this.resources.set(assetId, r);
      return r;
    }
    const file = this.files.get(assetId);
    if (!file) throw new Error('누락된 원본 파일을 보관함에서 재연결하세요.');
    const isImage = /^image\//.test(file.type) || /\.(png|jpe?g|webp|gif|avif)$/i.test(file.name);
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    if (isImage)
      r = { input, image: await createImageBitmap(file, { imageOrientation: 'from-image' }) };
    else {
      const [video, audio] = await Promise.all([
        input.getPrimaryVideoTrack(),
        input.getPrimaryAudioTrack(),
      ]);
      r = { input, video: video ?? undefined, audio: audio ?? undefined };
    }
    // Bounded source metadata/image cache; decoding cursors own only a few frames.
    if (this.resources.size >= 12) {
      const key = [...this.resources.keys()].find((k) => !this.pins.has(k));
      if (!key) {
        input.dispose();
        r.image?.close();
        throw new Error(
          '동시 디코딩 원본 12개 한도를 초과합니다. 일부 트랙을 숨기거나 음소거하세요.',
        );
      }
      const old = this.resources.get(key)!;
      old.input.dispose();
      old.image?.close();
      this.resources.delete(key);
    }
    this.resources.set(assetId, r);
    return r;
  }
  close() {
    for (const r of this.resources.values()) {
      r.input.dispose();
      r.image?.close();
    }
    this.resources.clear();
    this.files.clear();
    this.pins.clear();
  }
}
export async function probe(file: File): Promise<Asset> {
  if (file.size === 0) throw new Error('빈 파일입니다. 다른 파일을 선택하세요.');
  const asset: Asset = {
    id: id(),
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    kind: 'image',
    duration: tick(5),
    width: 0,
    height: 0,
    container: '',
    hasAudio: false,
    videoStart: 0,
    audioStart: 0,
    origin: 0,
    stored: false,
  };
  const pool = new MediaPool();
  pool.register(asset.id, file);
  try {
    const r = await pool.get(asset.id);
    if (r.image) {
      asset.width = r.image.width;
      asset.height = r.image.height;
      asset.container = file.type || file.name.split('.').at(-1)!;
      const c = new OffscreenCanvas(
        240,
        Math.max(1, Math.round((240 * asset.height) / asset.width)),
      );
      c.getContext('2d')!.drawImage(r.image, 0, 0, c.width, c.height);
      asset.thumbnail = await blobData(await c.convertToBlob({ type: 'image/jpeg', quality: 0.7 }));
      return asset;
    }
    const { video, audio, input } = r;
    asset.container = (await input.getFormat()).name;
    if (!video && !audio) throw new Error('편집 가능한 영상·오디오 트랙이 없습니다.');
    if (video && !(await video.canDecode()))
      throw new Error(
        `${asset.container} 안의 영상 코덱 ${video.codec ?? '알 수 없음'}을 이 브라우저가 디코딩하지 못합니다. MP4/H.264로 변환 후 다시 가져오세요.`,
      );
    if (audio && !(await audio.canDecode()))
      throw new Error(
        `${asset.container} 안의 오디오 코덱 ${audio.codec ?? '알 수 없음'}을 디코딩하지 못합니다. AAC, MP3 또는 PCM WAV로 변환하세요.`,
      );
    asset.kind = video ? 'video' : 'audio';
    asset.hasAudio = !!audio;
    asset.videoCodec = video?.codec ?? undefined;
    asset.audioCodec = audio?.codec ?? undefined;
    asset.videoStart = video ? await video.getFirstTimestamp() : 0;
    asset.audioStart = audio ? await audio.getFirstTimestamp() : 0;
    asset.origin = Math.min(
      video ? asset.videoStart : Infinity,
      audio ? asset.audioStart : Infinity,
    );
    asset.duration = tick(Math.max(0, (await input.computeDuration()) - asset.origin));
    if (!Number.isFinite(asset.duration) || asset.duration <= 0)
      throw new Error('파일 길이를 읽을 수 없습니다. 파일을 확인하거나 다시 인코딩하세요.');
    if (video) {
      asset.width = video.displayWidth;
      asset.height = video.displayHeight;
      const sink = new CanvasSink(video, { width: 240, fit: 'contain', poolSize: 1 });
      const frame = await sink.getCanvas(asset.videoStart);
      if (!frame) throw new Error('첫 영상 프레임을 디코딩할 수 없습니다.');
      asset.thumbnail = await blobData(
        await (frame.canvas as OffscreenCanvas).convertToBlob({ type: 'image/jpeg', quality: 0.7 }),
      );
    }
    return asset;
  } catch (e) {
    if (e instanceof Error && /변환|파일|코덱|트랙|디코딩/.test(e.message)) throw e;
    throw new Error(
      '파일을 분석할 수 없습니다. 손상 여부를 확인하거나 MP4/H.264 + AAC 또는 PCM WAV로 변환하세요.',
    );
  } finally {
    pool.close();
  }
}
async function blobData(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return `data:${blob.type};base64,${btoa(binary)}`;
}
export async function waveform(file: File, asset: Asset) {
  const pool = new MediaPool();
  pool.register(asset.id, file);
  try {
    const r = await pool.get(asset.id);
    if (!r.audio) return [];
    const sink = new AudioSampleSink(r.audio);
    const peaks = new Array<number>(120).fill(0);
    for await (const sample of sink.samples()) {
      const data = new Float32Array(sample.numberOfFrames);
      sample.copyTo(data, { planeIndex: 0, format: 'f32-planar' });
      const bin = Math.max(
        0,
        Math.min(
          119,
          Math.floor(((sample.timestamp - asset.audioStart) / seconds(asset.duration)) * 120),
        ),
      );
      for (let i = 0; i < data.length; i += 8) peaks[bin] = Math.max(peaks[bin], Math.abs(data[i]));
      sample.close();
    }
    return peaks;
  } finally {
    pool.close();
  }
}
export class VideoCursor {
  sink: CanvasSink;
  iterator?: AsyncGenerator<WrappedCanvas, void, unknown>;
  current?: WrappedCanvas;
  next?: WrappedCanvas;
  last = -Infinity;
  constructor(
    track: InputVideoTrack,
    maxWidth: number,
    public assetId: string,
  ) {
    this.sink = new CanvasSink(track, {
      width: Math.min(track.displayWidth, maxWidth),
      poolSize: 3,
    });
  }
  async at(time: number) {
    const timestamp = time + 0.5e-6; // Resolve sub-microsecond container PTS at the model's integer precision.
    if (!this.iterator || time < this.last || time - this.last > 0.75) {
      await this.close();
      this.iterator = this.sink.canvases(timestamp);
      this.current = (await this.iterator.next()).value || undefined;
      this.next = (await this.iterator.next()).value || undefined;
    }
    while (this.next && this.next.timestamp <= timestamp) {
      this.current = this.next;
      this.next = (await this.iterator!.next()).value || undefined;
    }
    this.last = time;
    return this.current?.canvas;
  }
  async close() {
    await this.iterator?.return();
    this.iterator = undefined;
    this.current = this.next = undefined;
    this.last = -Infinity;
  }
}
export class AudioCursor {
  iterator: AsyncGenerator<AudioSample, void, unknown>;
  current?: AudioSample;
  planes: Float32Array[] = [];
  constructor(
    track: InputAudioTrack,
    start: number,
    end: number,
    public assetId: string,
  ) {
    this.iterator = new AudioSampleSink(track).samples(start - 0.25, end);
  }
  async sample(time: number): Promise<[number, number]> {
    while (!this.current || time >= this.current.timestamp + this.current.duration) {
      this.current?.close();
      const next = await this.iterator.next();
      if (next.done) {
        this.current = undefined;
        return [0, 0];
      }
      this.current = next.value;
      this.planes = [];
      for (let c = 0; c < Math.min(2, this.current.numberOfChannels); c++) {
        const data = new Float32Array(this.current.numberOfFrames);
        this.current.copyTo(data, { planeIndex: c, format: 'f32-planar' });
        this.planes.push(data);
      }
    }
    if (time < this.current.timestamp) return [0, 0];
    const at = (time - this.current.timestamp) * this.current.sampleRate;
    const i = Math.floor(at),
      f = at - i;
    const values = this.planes.map(
      (p) => (p[i] ?? 0) * (1 - f) + (p[Math.min(p.length - 1, i + 1)] ?? 0) * f,
    );
    return [values[0] ?? 0, values[1] ?? values[0] ?? 0];
  }
  async close() {
    this.current?.close();
    this.current = undefined;
    this.planes = [];
    await this.iterator.return();
  }
}
export class AudioMixer {
  cursors = new Map<string, AudioCursor>();
  constructor(
    public project: Project,
    public pool: MediaPool,
  ) {}
  async block(startSample: number, count: number, rate = 48000) {
    const out = new Float32Array(count * 2);
    const from = startSample / rate,
      to = (startSample + count) / rate;
    const clips = this.project.clips.filter(
      (c) =>
        c.kind === 'audio' &&
        !this.project.tracks.find((t) => t.id === c.trackId)?.muted &&
        seconds(c.start) < to &&
        seconds(c.start + c.duration) > from,
    );
    for (const c of clips) {
      const asset = this.project.assets.find((a) => a.id === c.assetId)!;
      let cursor = this.cursors.get(c.id);
      if (!cursor) {
        const r = await this.pool.get(c.assetId!);
        if (!r.audio) throw new Error('원본 오디오 트랙을 찾을 수 없습니다.');
        cursor = new AudioCursor(
          r.audio,
          (asset.origin ?? asset.audioStart) + seconds(c.sourceIn),
          asset.audioStart + seconds(c.sourceIn + c.duration),
          asset.id,
        );
        this.pool.pin(asset.id);
        this.cursors.set(c.id, cursor);
      }
      const first = Math.max(0, Math.ceil(seconds(c.start) * rate) - startSample),
        last = Math.min(count, Math.ceil(seconds(c.start + c.duration) * rate) - startSample);
      for (let i = first; i < last; i++) {
        const t = (startSample + i) / rate;
        const values = await cursor.sample(
          (asset.origin ?? asset.audioStart) + seconds(c.sourceIn) + t - seconds(c.start),
        );
        const gain = audioGain(c, tick(t));
        out[i * 2] += values[0] * gain;
        out[i * 2 + 1] += values[1] * gain;
      }
    }
    for (const [key, cursor] of this.cursors) {
      const c = this.project.clips.find((c) => c.id === key);
      if (!c || seconds(c.start + c.duration) <= to) {
        await cursor.close();
        this.pool.release(cursor.assetId);
        this.cursors.delete(key);
      }
    }
    for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, out[i]));
    return out;
  }
  async close() {
    for (const cursor of this.cursors.values()) {
      await cursor.close();
      this.pool.release(cursor.assetId);
    }
    this.cursors.clear();
  }
}
