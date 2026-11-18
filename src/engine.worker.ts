import {
  Output,
  Mp4OutputFormat,
  WebMOutputFormat,
  WavOutputFormat,
  Mp3OutputFormat,
  CanvasSource,
  AudioSampleSource,
  AudioSample,
  type VideoCodec,
  type AudioCodec,
} from 'mediabunny';
import { probe, waveform, MediaPool, AudioMixer } from './media';
import { Renderer } from './render';
import { capabilities } from './codecs';
import { failureEvent, PipelineFailure } from './failures';
import { exportBudget } from './export-policy';
import { createExportOutput } from './export-output';
import type { ExportDestination } from './export-files';
import { ExportMetrics } from './export-metrics';
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
type PreviewRequest = { project: Project; time: number; seq: number; width: number };
let latest: PreviewRequest | undefined;
let rendering = false;
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
        scope.postMessage({
          type: 'error',
          requestId: data.requestId,
          ...failureEvent(e, 'probe'),
        }),
      );
    return;
  }
  if (data.type === 'waveform') {
    void waveform(data.file, data.asset as Asset, (completed) =>
      scope.postMessage({ type: 'progress', requestId: data.requestId, completed }),
    )
      .then((peaks) => scope.postMessage({ type: 'waveform', requestId: data.requestId, peaks }))
      .catch((e) =>
        scope.postMessage({
          type: 'error',
          requestId: data.requestId,
          ...failureEvent(e, 'waveform'),
        }),
      );
    return;
  }
  if (data.type === 'capabilities') {
    void capabilities(data.project, data.bitrate)
      .then((value) =>
        scope.postMessage({ type: 'capabilities', requestId: data.requestId, value }),
      )
      .catch((e) =>
        scope.postMessage({
          type: 'error',
          requestId: data.requestId,
          ...failureEvent(e, 'capabilities'),
        }),
      );
    return;
  }
  if (data.type === 'capture' || data.type === 'audio-analysis') {
    for (const source of data.sources ?? []) pool.register(source.id, source.file);
    void extra(data)
      .then((value) => scope.postMessage({ type: data.type, requestId: data.requestId, value }))
      .catch((e) =>
        scope.postMessage({
          type: 'error',
          requestId: data.requestId,
          ...failureEvent(e, data.type, data.project),
        }),
      );
    return;
  }
  if (data.type === 'export')
    void exportProject(
      data.project,
      data.format,
      data.bitrate,
      data.range,
      data.destination,
      data.profile,
    ).catch((e) =>
      scope.postMessage({ type: 'error', ...failureEvent(e, 'export', data.project) }),
    );
};
async function extra(data: { type: string; project: Project; time: number; requestId: number }) {
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
    for (let at = 0; at < count; at += 4096) {
      await mixer!.block(at, Math.min(4096, count - at));
      if (at % (4096 * 16) === 0)
        scope.postMessage({ type: 'progress', requestId: data.requestId, completed: at });
    }
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
      const data = latest;
      latest = undefined;
      try {
        const { project: p } = data;
        const width = Math.min(p.width, data.width),
          height = Math.round((width * p.height) / p.width);
        if (!renderer || renderer.canvas.width !== width || renderer.canvas.height !== height) {
          await renderer?.close();
          renderer = new Renderer(pool, new OffscreenCanvas(width, height));
          renderer.measureSelection = true;
        }
        await renderer.render(p, data.time);
        const bitmap = renderer.canvas.transferToImageBitmap();
        scope.postMessage(
          { type: 'frame', seq: data.seq, bitmap, textBounds: renderer.textBounds },
          [bitmap],
        );
      } catch (e) {
        // Drop broken cursors, then process the already-queued latest request.
        await renderer?.close().catch(() => {});
        renderer = undefined;
        scope.postMessage({
          type: 'preview-error',
          seq: data.seq,
          ...failureEvent(e, 'preview', data.project),
        });
      }
    }
  } finally {
    rendering = false;
  }
}
async function exportProject(
  raw: Project,
  format: 'mp4' | 'webm' | 'wav' | 'mp3',
  bitrate: number,
  range?: { start: number; end: number },
  destination: ExportDestination = { id: crypto.randomUUID() },
  profile = false,
) {
  const metrics = new ExportMetrics(profile);
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
  const budget = exportBudget(format, length, p.fps, bitrate);
  if (!budget.allowed)
    throw new Error('출력 길이·FPS·비트레이트가 올바르지 않거나 정확히 계산할 수 없는 값입니다.');
  const caps = await capabilities(p, bitrate, format);
  if (!caps[format])
    throw new PipelineFailure(
      'OUTPUT_UNSUPPORTED',
      caps.errors?.[format] ??
        '선택한 해상도·FPS·코덱의 인코더를 사용할 수 없습니다. WebM 또는 WAV를 선택하세요.',
    );
  let output: Output | undefined;
  let visual: Renderer | undefined;
  let mixer: AudioMixer | undefined;
  let sink: Awaited<ReturnType<typeof createExportOutput>> | undefined;
  const releaseQueueProbe = metrics.watchVideoQueue();
  try {
    scope.postMessage({ type: 'progress', stage: '폰트 · 원본 확인', progress: 0 });
    for (const key of requiredAssets(p, from, to, format === 'mp4' || format === 'webm'))
      if (!pool.files.has(key))
        throw new Error(`원본이 누락되었습니다: ${p.assets.find((a) => a.id === key)?.name}`);
    sink = await metrics.measure('destination', () => createExportOutput(destination, format));
    const target = sink.target;
    output = new Output({
      target,
      format:
        format === 'mp4'
          ? new Mp4OutputFormat({ fastStart: sink.streaming ? false : 'in-memory' })
          : format === 'webm'
            ? new WebMOutputFormat()
            : format === 'mp3'
              ? new Mp3OutputFormat()
              : new WavOutputFormat({ large: length * 48000 * 4 + 44 > 0xffffffff }),
    });
    let video: CanvasSource | undefined;
    if (format === 'mp4' || format === 'webm') {
      const codec: VideoCodec = format === 'mp4' ? 'avc' : caps.vp9 ? 'vp9' : 'vp8';
      const canvas = new OffscreenCanvas(p.width, p.height);
      visual = new Renderer(pool, canvas, metrics);
      await metrics.measure('prepare/fonts', () => visual!.render(p, from));
      video = new CanvasSource(canvas, {
        codec,
        bitrate,
        keyFrameInterval: 2,
        onEncodedPacket: profile
          ? () => {
              metrics.encodedVideoPackets++;
            }
          : undefined,
      });
      output.addVideoTrack(video, { frameRate: p.fps });
    }
    const audioCodec: AudioCodec =
      format === 'mp4' ? 'aac' : format === 'webm' ? 'opus' : format === 'mp3' ? 'mp3' : 'pcm-s16';
    const audio = new AudioSampleSource({
      codec: audioCodec,
      bitrate: 192000,
    });
    output.addAudioTrack(audio);
    mixer = new AudioMixer(p, pool);
    await output.start();
    const frameCount = Math.ceil(length * p.fps),
      sampleCount = Math.ceil((video ? frameCount / p.fps : length) * 48000);
    let audioAt = 0;
    async function encodeAudioUntil(boundary: number) {
      while (audioAt < boundary) {
        const count = Math.min(4096, boundary - audioAt);
        const data = await metrics.measure('audio decode/mix', () =>
          mixer!.block(Math.round(seconds(from) * 48000) + audioAt, count),
        );
        const sample = new AudioSample({
          data,
          format: 'f32',
          numberOfChannels: 2,
          sampleRate: 48000,
          timestamp: audioAt / 48000,
        });
        try {
          await metrics.measure('audio encode', () => audio.add(sample));
        } finally {
          sample.close();
        }
        audioAt += count;
      }
    }
    if (video && visual) {
      for (let frame = 0; frame < frameCount; frame++) {
        const time = from + frameTick(frame, p.fps);
        await metrics.measure('render including decode', () => visual!.render(p, time));
        const boundary = Math.min(sampleCount, Math.ceil(((frame + 1) / p.fps) * 48000));
        // One frame at a time: mix the matching audio while the encoder drains its bounded queue.
        // Both operations settle before the canvas is changed for the next frame.
        const pending = await Promise.allSettled([
          metrics.measure('video encode/backpressure', () => video!.add(frame / p.fps, 1 / p.fps)),
          encodeAudioUntil(boundary),
        ]);
        const rejected = pending.find((result) => result.status === 'rejected');
        if (rejected?.status === 'rejected') throw rejected.reason;
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
        await encodeAudioUntil(Math.min(sampleCount, audioAt + 4096));
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
    await metrics.measure('mux/finalize', () => output!.finalize());
    const result = await metrics.measure('save', () => sink!.complete());
    scope.postMessage(
      {
        type: 'complete',
        ...result,
        format,
        metrics: metrics.result(),
        audio: { peak: mixer.peak, clippedSamples: mixer.clippedSamples },
      },
      result.buffer ? [result.buffer] : [],
    );
  } catch (e) {
    await output?.cancel().catch(() => {});
    await sink?.abort().catch(() => {});
    if (e instanceof DOMException && e.name === 'QuotaExceededError')
      throw new PipelineFailure(
        'STORAGE_FULL',
        '실제 저장 공간이 부족해 출력을 중단했습니다. 공간을 확보하거나 파일로 직접 저장할 수 있는 브라우저에서 다시 시도하세요. 프로젝트는 유지됩니다.',
      );
    if (e instanceof RangeError)
      throw new PipelineFailure(
        'RESOURCE_LIMIT',
        '이 기기의 메모리 또는 파일 처리 범위를 초과했습니다. 다른 브라우저에서 파일로 직접 저장하거나 구간을 나누어 다시 시도하세요. 프로젝트는 유지됩니다.',
      );
    throw e;
  } finally {
    releaseQueueProbe();
    await mixer?.close();
    await visual?.close();
    pool.close();
  }
}
