import { Input, BlobSource, ALL_FORMATS, CanvasSink, AudioSampleSink } from 'mediabunny';
import { createEngine, inspect } from '../src/engine';
import { Renderer } from '../src/render';
import { MediaPool, AudioMixer } from '../src/media';
import { emptyProject, clipDefaults, tick, frameTick, type Project } from '../src/model';
import { setTransitionV2, transitionWindow } from '../src/transitions';
import { textPresets } from '../src/text-styles';
export async function encodeProject(project: Project, sources: { id: string; file: File }[] = []) {
  const worker = createEngine();
  try {
    return await new Promise<ArrayBuffer>((resolve, reject) => {
      let timer = setTimeout(() => reject(new Error('Output stalled')), 120000);
      worker.onmessage = async (event) => {
        const d = event.data;
        if (d.type === 'progress') {
          clearTimeout(timer);
          timer = setTimeout(() => reject(new Error('Output stalled')), 120000);
        }
        if (d.type === 'error') {
          clearTimeout(timer);
          reject(new Error(d.error));
        }
        if (d.type === 'complete') {
          clearTimeout(timer);
          resolve(d.buffer ?? (await d.file.arrayBuffer()));
        }
      };
      worker.onerror = (e) => {
        clearTimeout(timer);
        reject(new Error(e.message));
      };
      for (const s of sources) worker.postMessage({ type: 'file', ...s });
      worker.postMessage({ type: 'export', project, format: 'mp4', bitrate: 8e6 });
    });
  } finally {
    worker.terminate();
  }
}
export async function verifyFile(file: File, times: number[] = [0.5]) {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const video = await input.getPrimaryVideoTrack(),
      audio = await input.getPrimaryAudioTrack();
    const positions = [];
    if (video) {
      const sink = new CanvasSink(video, { width: 320 });
      for (const time of times) {
        const frame = await sink.getCanvas(time);
        if (!frame) throw new Error('Missing decoded frame');
        const c = frame.canvas,
          ctx = c.getContext('2d')!;
        positions.push({
          time,
          pts: frame.timestamp,
          pixel: Array.from(
            ctx.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data,
          ),
        });
      }
    }
    const sound = [];
    if (audio) {
      const sink = new AudioSampleSink(audio);
      for (const t of times) {
        const sample = await sink.getSample(t);
        if (!sample) throw new Error('Missing decoded audio');
        try {
          const bytes = new Float32Array(sample.numberOfFrames);
          sample.copyTo(bytes, { format: 'f32-planar', planeIndex: 0 });
          sound.push({
            time: t,
            pts: sample.timestamp,
            rms: Math.sqrt(bytes.reduce((sum, v) => sum + v * v, 0) / bytes.length),
          });
        } finally {
          sample.close();
        }
      }
    }
    return {
      videoDuration: await video?.computeDuration(),
      audioDuration: await audio?.computeDuration(),
      width: video?.displayWidth,
      height: video?.displayHeight,
      positions,
      sound,
    };
  } finally {
    input.dispose();
  }
}
export async function compareOutput(
  p: Project,
  bytes: number[],
  sources: { id: string; file: File }[],
  times: number[],
) {
  const file = new File([new Uint8Array(bytes)], 'output.mp4', { type: 'video/mp4' }),
    input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const pool = new MediaPool(),
    canvas = new OffscreenCanvas(p.width, p.height),
    renderer = new Renderer(pool, canvas);
  for (const s of sources) pool.register(s.id, s.file);
  try {
    const track = (await input.getPrimaryVideoTrack())!,
      sink = new CanvasSink(track);
    const errors = [];
    for (const time of times) {
      const quantized = frameTick(Math.floor((time + 1e-6) * p.fps), p.fps);
      await renderer.render(p, quantized);
      const actual = await sink.getCanvas((quantized + 0.5) / 1e6);
      if (!actual) throw new Error('Missing frame');
      const a = actual.canvas.getContext('2d')!.getImageData(0, 0, p.width, p.height).data,
        b = canvas.getContext('2d')!.getImageData(0, 0, p.width, p.height).data;
      let error = 0,
        ink = 0,
        decodedInk = 0;
      for (let i = 0; i < a.length; i += 4) {
        error +=
          Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
        if (b[i] + b[i + 1] + b[i + 2] > 160) {
          ink++;
          if (a[i] + a[i + 1] + a[i + 2] > 100) decodedInk++;
        }
      }
      errors.push({
        time: quantized / 1e6,
        pts: actual.timestamp,
        mae: error / (p.width * p.height * 3),
        ink,
        retainedInk: ink ? decodedInk / ink : 1,
      });
    }
    return errors;
  } finally {
    await renderer.close();
    pool.close();
    input.dispose();
  }
}
export async function transitionMatrix(
  fixtures: { name: string; bytes: number[]; mimeType: string }[],
) {
  const sources = [];
  for (const f of fixtures.filter((f) => f.name.endsWith('.mp4'))) {
    const file = new File([new Uint8Array(f.bytes)], f.name, { type: f.mimeType }),
      asset = await inspect(file);
    sources.push({ id: asset.id, file, asset });
  }
  const records = [];
  for (const fps of [24, 30, 60])
    for (const kind of ['dissolve', 'black', 'slide', 'wipe'] as const) {
      const p = emptyProject();
      p.width = 640;
      p.height = 360;
      p.fps = fps;
      p.assets = sources.map((s) => s.asset);
      p.clips = [0, 1].map((i) => ({
        ...clipDefaults(),
        id: `v${i}`,
        kind: 'video' as const,
        name: `v${i}`,
        trackId: p.tracks[1].id,
        assetId: p.assets[i].id,
        start: tick(i),
        duration: tick(1),
        sourceIn: tick(0.25),
      }));
      const result = setTransitionV2(p, 'v1', kind, tick(0.4)).project;
      if (!result.clips[1].transition) throw new Error('Transition did not apply');
      const w = transitionWindow(result.clips[1], fps),
        times = [
          w.start / 1e6,
          (w.start + (w.end - w.start) * 0.25) / 1e6,
          1,
          (w.start + (w.end - w.start) * 0.75) / 1e6,
          w.end / 1e6,
        ];
      const bytes = await encodeProject(result, sources),
        errors = await compareOutput(result, Array.from(new Uint8Array(bytes)), sources, times);
      records.push({ fps, kind, frames: result.clips[1].transition.frames, errors });
    }
  return records;
}
export async function presetMatrix(width: number, height: number) {
  const p = emptyProject();
  p.width = width;
  p.height = height;
  p.clips = textPresets.map((preset, i) => ({
    ...clipDefaults(),
    id: `text${i}`,
    kind: 'text' as const,
    name: preset.name,
    trackId: p.tracks[0].id,
    start: 0,
    duration: tick(1),
    sourceIn: 0,
    x: ((i % 2) + 0.5) / 2,
    y: (Math.floor(i / 2) + 0.5) / 3,
    scale: 0.38,
    text: {
      ...structuredClone(preset.style),
      text: `한글 👩‍💻 자막 ${i}\n긴 줄바꿈과 스타일`,
      boxWidth: width * 0.8,
    },
  }));
  const bytes = await encodeProject(p),
    errors = await compareOutput(p, Array.from(new Uint8Array(bytes)), [], [0, 0.5]);
  return { bytes: Array.from(new Uint8Array(bytes)), project: p, errors };
}

export async function extendedTransitions(
  fixtures: { name: string; mimeType: string; bytes: number[] }[],
) {
  const sources = [];
  for (const f of fixtures) {
    const file = new File([new Uint8Array(f.bytes)], f.name, { type: f.mimeType }),
      asset = await inspect(file);
    sources.push({ id: asset.id, file, asset });
  }
  const p = emptyProject();
  p.width = 640;
  p.height = 360;
  p.assets = sources.map((s) => s.asset);
  p.clips = [0, 1].flatMap((i) => {
    const v = {
      ...clipDefaults(),
      id: `v${i}`,
      name: `v${i}`,
      kind: 'video' as const,
      assetId: p.assets[i].id,
      trackId: p.tracks[1].id,
      start: tick(i),
      duration: tick(1),
      sourceIn: tick(0.25),
      linkId: `l${i}`,
    };
    return [v, { ...v, id: `a${i}`, kind: 'audio' as const, trackId: p.tracks[2].id }];
  });
  const image = p.assets.find((a) => a.kind === 'image')!,
    music = p.assets.find((a) => a.kind === 'audio')!;
  const transparent = structuredClone(p);
  transparent.clips = transparent.clips
    .filter((c) => c.kind === 'video')
    .map((c) => ({ ...c, linkId: undefined }));
  transparent.clips[1] = { ...transparent.clips[1], kind: 'image', assetId: image.id, sourceIn: 0 };
  const visual = [];
  for (const kind of ['dissolve', 'wipe', 'white'] as const) {
    const q =
      kind === 'white'
        ? structuredClone(transparent)
        : setTransitionV2(transparent, 'v1', kind, tick(0.4)).project;
    if (kind === 'white') q.clips[1].transition = { kind: 'white', duration: tick(0.2) };
    const bytes = await encodeProject(q, sources);
    visual.push({
      kind,
      errors: await compareOutput(
        q,
        Array.from(new Uint8Array(bytes)),
        sources,
        [0.8, 0.9, 1, 1.1, 1.2],
      ),
    });
  }
  const audio = [];
  for (const kind of ['dissolve', 'black'] as const) {
    const q = setTransitionV2(p, 'v1', kind, tick(0.4), 'left', true).project;
    q.clips.push({
      ...clipDefaults(),
      id: 'bgm',
      name: 'bgm',
      kind: 'audio',
      assetId: music.id,
      trackId: p.tracks[3].id,
      start: 0,
      duration: tick(2),
      sourceIn: 0,
    });
    const pools = [new MediaPool(), new MediaPool(), new MediaPool()];
    for (const pool of pools) for (const s of sources) pool.register(s.id, s.file);
    const mixers = [
      new AudioMixer(q, pools[0]),
      new AudioMixer({ ...q, clips: q.clips.filter((c) => c.id !== 'bgm') }, pools[1]),
      new AudioMixer({ ...q, clips: q.clips.filter((c) => c.id === 'bgm') }, pools[2]),
    ];
    let peak = 0,
      energy = 0,
      bgmDelta = 0,
      maxSampleStep = 0,
      last = 0,
      samples = 0,
      maxSampleStepAt = 0,
      transitionSampleStep = 0;
    try {
      for (let at = 0; at < 96000; at += 2048) {
        const blocks = await Promise.all(
          mixers.map((m) => m.block(at, Math.min(2048, 96000 - at))),
        );
        for (let i = 0; i < blocks[0].length; i += 2) {
          const value = blocks[0][i];
          peak = Math.max(peak, Math.abs(value));
          energy += value * value;
          samples++;
          const t = (at + i / 2) / 48000,
            step = Math.abs(value - last);
          if ((at || i) && step > maxSampleStep) {
            maxSampleStep = step;
            maxSampleStepAt = t;
          }
          if (t >= 0.75 && t <= 1.25) transitionSampleStep = Math.max(transitionSampleStep, step);
          last = value;
          bgmDelta = Math.max(bgmDelta, Math.abs(value - blocks[1][i] - blocks[2][i]));
        }
      }
    } finally {
      await Promise.all(mixers.map((m) => m.close()));
      for (const pool of pools) pool.close();
    }
    const bytes = await encodeProject(q, sources),
      output = await verifyFile(new File([bytes], 'transition.mp4'), [0.8, 1, 1.2]);
    audio.push({
      kind,
      peak,
      rms: Math.sqrt(energy / samples),
      bgmDelta,
      maxSampleStep,
      maxSampleStepAt,
      transitionSampleStep,
      output,
    });
  }
  return { visual, audio };
}
