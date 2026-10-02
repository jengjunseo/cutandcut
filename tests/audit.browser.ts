import { Input, BufferSource, ALL_FORMATS, AudioSampleSink, CanvasSink } from 'mediabunny';
import { createEngine, inspect, request } from '../src/engine';
import { emptyProject, addAsset, tick, type Project } from '../src/model';
import { changeSpeed } from '../src/editing';
import { makeFixtures } from './fixtures.browser';
async function output(
  p: Project,
  sources: { id: string; file: File }[],
  format = 'wav',
  range?: { start: number; end: number },
): Promise<ArrayBuffer> {
  const w = createEngine();
  try {
    return await new Promise((resolve, reject) => {
      w.onmessage = (e) => {
        if (e.data.type === 'complete') resolve(e.data.buffer);
        if (e.data.type === 'error') reject(new Error(e.data.error));
      };
      w.onerror = (e) => reject(new Error(e.message));
      for (const s of sources) w.postMessage({ type: 'file', ...s });
      w.postMessage({ type: 'export', project: p, format, bitrate: 4e6, range });
    });
  } finally {
    w.terminate();
  }
}
async function audioInfo(buffer: ArrayBuffer) {
  const input = new Input({ source: new BufferSource(buffer), formats: ALL_FORMATS });
  try {
    const track = (await input.getPrimaryAudioTrack())!;
    const length = await input.computeDuration();
    let crossing = 0,
      previous = 0,
      energy = 0,
      count = 0,
      peak = 0;
    for await (const sample of new AudioSampleSink(track).samples()) {
      const data = new Float32Array(sample.numberOfFrames);
      sample.copyTo(data, { planeIndex: 0, format: 'f32-planar' });
      for (let i = 0; i < data.length; i++) {
        const t = sample.timestamp + i / sample.sampleRate;
        if (t >= 0.2 && t < length - 0.2) {
          if (previous <= 0 && data[i] > 0) crossing++;
          previous = data[i];
          energy += data[i] ** 2;
          count++;
          peak = Math.max(peak, Math.abs(data[i]));
        }
      }
      sample.close();
    }
    return {
      length,
      frequency: crossing / Math.max(0.01, count / 48000),
      rms: Math.sqrt(energy / Math.max(1, count)),
      peak,
      codec: track.codec,
    };
  } finally {
    input.dispose();
  }
}
export async function verifySpeed() {
  const fixtures = await makeFixtures(),
    f = fixtures[0],
    file = new File([new Uint8Array(f.bytes)], f.name, { type: f.mimeType }),
    asset = await inspect(file),
    sources = [{ id: asset.id, file }];
  const original = addAsset(emptyProject(), asset, 0),
    video = original.clips.find((c) => c.kind === 'video')!,
    results = [];
  const controller = new AbortController(),
    cancelled = request('audio-analysis', { project: original, sources }, controller.signal).catch(
      (e) => (e as DOMException).name,
    );
  controller.abort();
  for (const [speed, preservePitch] of [
    [0.5, true],
    [0.75, true],
    [1.5, true],
    [2, true],
    [2, false],
  ] as const) {
    const p = changeSpeed(original, [video.id], speed, preservePitch),
      buffer = await output(p, sources);
    results.push({ speed, preservePitch, ...(await audioInfo(buffer)) });
  }
  const p = {
    ...original,
    clips: original.clips.map((c) => (c.kind === 'audio' ? { ...c, volume: 2 } : c)),
  };
  for (let i = 0; i < 5; i++)
    p.clips.push({
      ...p.clips.find((c) => c.kind === 'audio')!,
      id: `mix-test-${i}`,
      linkId: undefined,
    });
  const result = await request<{ peak: number; clippedSamples: number; rms: number }>(
    'audio-analysis',
    { project: p, sources },
  );
  const normalized = { ...p, masterVolume: 0.95 / result.peak };
  const buffer = await output(normalized, sources);
  const blob = await request<Blob>('capture', { project: original, time: tick(0.5), sources }),
    image = await createImageBitmap(blob),
    canvas = new OffscreenCanvas(image.width, image.height);
  canvas.getContext('2d')!.drawImage(image, 0, 0);
  const color = Array.from(canvas.getContext('2d')!.getImageData(100, 100, 1, 1).data);
  const imageInfo = { width: image.width, height: image.height, color, bytes: blob.size };
  image.close();
  return {
    cancelled: await cancelled,
    sourceDuration: asset.duration / 1e6,
    results,
    analysis: result,
    normalized: await audioInfo(buffer),
    image: imageInfo,
  };
}
export async function verifyRange() {
  const fixtures = await makeFixtures(),
    sources = [];
  let p = emptyProject();
  for (const f of fixtures.slice(0, 2)) {
    const file = new File([new Uint8Array(f.bytes)], f.name, { type: f.mimeType }),
      a = await inspect(file);
    sources.push({ id: a.id, file });
    p = addAsset(p, a);
  }
  const buffer = await output(p, sources, 'mp4', { start: tick(1), end: tick(3) }),
    input = new Input({ source: new BufferSource(buffer), formats: ALL_FORMATS });
  try {
    const v = (await input.getPrimaryVideoTrack())!,
      sink = new CanvasSink(v, { poolSize: 1 }),
      pixels = [];
    for (const at of [0.25, 1.25]) {
      const frame = (await sink.getCanvas(at))!;
      pixels.push(Array.from(frame.canvas.getContext('2d')!.getImageData(100, 100, 1, 1).data));
    }
    return {
      bytes: Array.from(new Uint8Array(buffer)),
      length: await input.computeDuration(),
      pixels,
      width: v.displayWidth,
      height: v.displayHeight,
      audio: await audioInfo(buffer),
    };
  } finally {
    input.dispose();
  }
}
