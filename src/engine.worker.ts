import {
  Output,
  BufferTarget,
  Mp4OutputFormat,
  WebMOutputFormat,
  WavOutputFormat,
  Mp3OutputFormat,
  CanvasSource,
  AudioSampleSource,
  AudioSample,
  canEncodeAudio,
  canEncodeVideo,
  type VideoCodec,
  type AudioCodec,
} from 'mediabunny';
import { probe, waveform, MediaPool, AudioMixer } from './media';
import { Renderer } from './render';
import {
  duration,
  seconds,
  frameTick,
  validateProject,
  requiredAssets,
  type Project,
  type Asset,
} from './model';
const scope = self as unknown as {
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
  onmessage: ((event: MessageEvent) => void) | null;
};
const pool = new MediaPool();
let renderer: Renderer | undefined;
let latest: Record<string, unknown> | undefined;
let rendering = false;
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
scope.onmessage = (event) => {
  const data = event.data;
  if (data.type === 'file') {
    pool.register(data.id, data.file);
    return;
  }
  if (data.type === 'preview') {
    latest = data;
    void preview();
    return;
  }
  if (data.type === 'probe') {
    void probe(data.file)
      .then((asset) => scope.postMessage({ type: 'probe', requestId: data.requestId, asset }))
      .catch((e) =>
        scope.postMessage({ type: 'error', requestId: data.requestId, error: errorText(e) }),
      );
    return;
  }
  if (data.type === 'waveform') {
    void waveform(data.file, data.asset as Asset)
      .then((peaks) => scope.postMessage({ type: 'waveform', requestId: data.requestId, peaks }))
      .catch((e) =>
        scope.postMessage({ type: 'error', requestId: data.requestId, error: errorText(e) }),
      );
    return;
  }
  if (data.type === 'capabilities') {
    void capabilities(data.project, data.bitrate)
      .then((value) =>
        scope.postMessage({ type: 'capabilities', requestId: data.requestId, value }),
      )
      .catch((e) =>
        scope.postMessage({ type: 'error', requestId: data.requestId, error: errorText(e) }),
      );
    return;
  }
  if (data.type === 'capture' || data.type === 'audio-analysis') {
    for (const source of data.sources ?? []) pool.register(source.id, source.file);
    void extra(data)
      .then((value) => scope.postMessage({ type: data.type, requestId: data.requestId, value }))
      .catch((e) =>
        scope.postMessage({ type: 'error', requestId: data.requestId, error: errorText(e) }),
      );
    return;
  }
  if (data.type === 'export')
    void exportProject(data.project, data.format, data.bitrate, data.range).catch((e) =>
      scope.postMessage({ type: 'error', error: errorText(e) }),
    );
};
async function extra(data: { type: string; project: Project; time: number }) {
  const p = validateProject(data.project);
  const visual =
    data.type === 'capture'
      ? new Renderer(pool, new OffscreenCanvas(p.width, p.height))
      : undefined;
  const mixer = data.type === 'audio-analysis' ? new AudioMixer(p, pool) : undefined;
  try {
    if (visual) {
      await visual.render(p, data.time);
      return await visual.canvas.convertToBlob({ type: 'image/png' });
    }
    const count = Math.ceil(seconds(duration(p)) * 48000);
    if (count > 300 * 48000) throw new Error('음량 검사는 5분 이하 프로젝트를 지원합니다.');
    for (let at = 0; at < count; at += 4096) await mixer!.block(at, Math.min(4096, count - at));
    return {
      peak: mixer!.peak,
      clippedSamples: mixer!.clippedSamples,
      rms: Math.sqrt(mixer!.sumSquares / Math.max(1, mixer!.samples)),
    };
  } finally {
    await visual?.close();
    await mixer?.close();
    pool.close();
  }
}
async function preview() {
  if (rendering) return;
  rendering = true;
  try {
    while (latest) {
      const data = latest as unknown as {
        project: Project;
        time: number;
        seq: number;
        width: number;
      };
      latest = undefined;
      const { project: p } = data;
      const width = Math.min(p.width, data.width),
        height = Math.round((width * p.height) / p.width);
      if (!renderer || renderer.canvas.width !== width || renderer.canvas.height !== height) {
        await renderer?.close();
        renderer = new Renderer(pool, new OffscreenCanvas(width, height));
      }
      await renderer.render(p, data.time);
      const bitmap = renderer.canvas.transferToImageBitmap();
      scope.postMessage({ type: 'frame', seq: data.seq, bitmap }, [bitmap]);
    }
  } catch (e) {
    scope.postMessage({ type: 'preview-error', error: errorText(e) });
  } finally {
    rendering = false;
  }
}
async function capabilities(p: Project, bitrate: number) {
  const options = { width: p.width, height: p.height, frameRate: p.fps, bitrate };
  const { registerMp3Encoder } = await import('@mediabunny/mp3-encoder');
  registerMp3Encoder();
  const [avc, vp9, vp8, nativeAac, opus, mp3] = await Promise.all([
    canEncodeVideo('avc', options),
    canEncodeVideo('vp9', options),
    canEncodeVideo('vp8', options),
    canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48000, bitrate: 192000 }),
    canEncodeAudio('opus', { numberOfChannels: 2, sampleRate: 48000, bitrate: 192000 }),
    canEncodeAudio('mp3', { numberOfChannels: 2, sampleRate: 48000, bitrate: 192000 }),
  ]);
  let aac = nativeAac;
  if (!aac) {
    const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
    registerAacEncoder();
    aac = await canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48000, bitrate: 192000 });
  }
  return {
    mp4: avc && aac,
    webm: (vp9 || vp8) && opus,
    wav: true,
    mp3,
    vp9,
    avc,
    aacFallback: !nativeAac && aac,
  };
}
async function exportProject(
  raw: Project,
  format: 'mp4' | 'webm' | 'wav' | 'mp3',
  bitrate: number,
  range?: { start: number; end: number },
) {
  const p = validateProject(raw);
  const from = range?.start ?? 0,
    to = range?.end ?? duration(p);
  if (
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    from < 0 ||
    to <= from ||
    to > duration(p)
  )
    throw new Error('출력 범위가 올바르지 않습니다.');
  const length = seconds(to - from);
  if (length <= 0) throw new Error('내보낼 클립을 추가하세요.');
  if (length > 300)
    throw new Error('현재 로컬 내보내기는 메모리 보호를 위해 5분 이하로 제한합니다.');
  if (
    length * (format === 'wav' ? 48000 * 4 : format === 'mp3' ? 192000 / 8 : bitrate / 8) >
    256 * 1024 * 1024
  )
    throw new Error('예상 출력이 256MB를 초과합니다. 비트레이트나 길이를 줄이세요.');
  const caps = await capabilities(p, bitrate);
  if (!caps[format])
    throw new Error(
      '선택한 해상도·FPS·코덱의 인코더를 사용할 수 없습니다. WebM 또는 WAV를 선택하세요.',
    );
  let output: Output | undefined;
  let visual: Renderer | undefined;
  let mixer: AudioMixer | undefined;
  try {
    scope.postMessage({ type: 'progress', stage: '폰트 · 원본 확인', progress: 0 });
    for (const key of requiredAssets(p, from, to, format === 'mp4' || format === 'webm'))
      if (!pool.files.has(key))
        throw new Error(`원본이 누락되었습니다: ${p.assets.find((a) => a.id === key)?.name}`);
    const target = new BufferTarget();
    output = new Output({
      target,
      format:
        format === 'mp4'
          ? new Mp4OutputFormat({ fastStart: 'in-memory' })
          : format === 'webm'
            ? new WebMOutputFormat()
            : format === 'mp3'
              ? new Mp3OutputFormat()
              : new WavOutputFormat(),
    });
    let video: CanvasSource | undefined;
    if (format === 'mp4' || format === 'webm') {
      const codec: VideoCodec = format === 'mp4' ? 'avc' : caps.vp9 ? 'vp9' : 'vp8';
      const canvas = new OffscreenCanvas(p.width, p.height);
      visual = new Renderer(pool, canvas);
      await visual.render(p, from);
      video = new CanvasSource(canvas, { codec, bitrate, keyFrameInterval: 2 });
      output.addVideoTrack(video, { frameRate: p.fps });
    }
    const audioCodec: AudioCodec =
      format === 'mp4' ? 'aac' : format === 'webm' ? 'opus' : format === 'mp3' ? 'mp3' : 'pcm-s16';
    const audio = new AudioSampleSource({ codec: audioCodec, bitrate: 192000 });
    output.addAudioTrack(audio);
    mixer = new AudioMixer(p, pool);
    await output.start();
    const frameCount = Math.ceil(length * p.fps),
      sampleCount = Math.ceil((video ? frameCount / p.fps : length) * 48000);
    let audioAt = 0;
    if (video && visual) {
      for (let frame = 0; frame < frameCount; frame++) {
        const time = from + frameTick(frame, p.fps);
        await visual.render(p, time);
        await video.add(frame / p.fps, 1 / p.fps);
        const boundary = Math.min(sampleCount, Math.ceil(((frame + 1) / p.fps) * 48000));
        while (audioAt < boundary) {
          const count = Math.min(4096, boundary - audioAt);
          const data = await mixer.block(Math.round(seconds(from) * 48000) + audioAt, count);
          const sample = new AudioSample({
            data,
            format: 'f32',
            numberOfChannels: 2,
            sampleRate: 48000,
            timestamp: audioAt / 48000,
          });
          try {
            await audio.add(sample);
          } finally {
            sample.close();
          }
          audioAt += count;
        }
        if (frame % Math.max(1, Math.floor(p.fps / 4)) === 0)
          scope.postMessage({
            type: 'progress',
            stage: '영상 · 오디오 인코딩',
            progress: (frame + 1) / frameCount,
            frames: frame + 1,
            total: frameCount,
          });
      }
    } else {
      while (audioAt < sampleCount) {
        const count = Math.min(4096, sampleCount - audioAt);
        const data = await mixer.block(Math.round(seconds(from) * 48000) + audioAt, count);
        const sample = new AudioSample({
          data,
          format: 'f32',
          numberOfChannels: 2,
          sampleRate: 48000,
          timestamp: audioAt / 48000,
        });
        try {
          await audio.add(sample);
        } finally {
          sample.close();
        }
        audioAt += count;
        if (audioAt % 65536 < 4096)
          scope.postMessage({
            type: 'progress',
            stage: '오디오 믹싱 · 인코딩',
            progress: audioAt / sampleCount,
          });
      }
    }
    video?.close();
    audio.close();
    scope.postMessage({ type: 'progress', stage: '컨테이너 마무리', progress: 1 });
    await output.finalize();
    const buffer = target.buffer!;
    scope.postMessage(
      {
        type: 'complete',
        buffer,
        format,
        audio: { peak: mixer.peak, clippedSamples: mixer.clippedSamples },
      },
      [buffer],
    );
  } catch (e) {
    await output?.cancel();
    throw e;
  } finally {
    await mixer?.close();
    await visual?.close();
    pool.close();
  }
}
