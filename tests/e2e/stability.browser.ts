import {
  Output,
  BufferTarget,
  Mp4OutputFormat,
  CanvasSource,
  AudioSampleSource,
  AudioSample,
} from 'mediabunny';

/** Synthetic SDR fixture, not phone camera/HDR compatibility evidence. */
export async function rotated4k60() {
  const canvas = document.createElement('canvas');
  canvas.width = 3840;
  canvas.height = 2160;
  const ctx = canvas.getContext('2d')!;
  for (const [index, color] of ['#c83232', '#32c832', '#3232c8', '#c8c832'].entries()) {
    ctx.fillStyle = color;
    ctx.fillRect((index % 2) * 1920, Math.floor(index / 2) * 1080, 1920, 1080);
  }
  const target = new BufferTarget();
  const output = new Output({ target, format: new Mp4OutputFormat() });
  const video = new CanvasSource(canvas, { codec: 'avc', bitrate: 2000000 });
  const audio = new AudioSampleSource({ codec: 'aac', bitrate: 96000 });
  output.addVideoTrack(video, { frameRate: 60, rotation: 90 });
  output.addAudioTrack(audio);
  await output.start();
  for (let i = 0; i < 120; i++) {
    await video.add(i / 60, 1 / 60);
    const data = new Float32Array(800);
    for (let j = 0; j < data.length; j++)
      data[j] = Math.sin(((i * 800 + j) / 48000) * Math.PI * 2 * 440) * 0.15;
    const sample = new AudioSample({
      data,
      format: 'f32',
      sampleRate: 48000,
      numberOfChannels: 1,
      timestamp: i / 60,
    });
    try {
      await audio.add(sample);
    } finally {
      sample.close();
    }
  }
  video.close();
  audio.close();
  await output.finalize();
  canvas.width = canvas.height = 1;
  return {
    name: 'synthetic-rotated-4k60.mp4',
    mimeType: 'video/mp4',
    bytes: Array.from(new Uint8Array(target.buffer!)),
  };
}

export async function analyzeRotated(bytes: number[]) {
  const { Input, BufferSource, ALL_FORMATS, CanvasSink, AudioSampleSink } =
    await import('mediabunny');
  const input = new Input({
    source: new BufferSource(new Uint8Array(bytes)),
    formats: ALL_FORMATS,
  });
  try {
    const video = (await input.getPrimaryVideoTrack())!;
    const audio = (await input.getPrimaryAudioTrack())!;
    const sink = new CanvasSink(video, { poolSize: 1 });
    const frames = [];
    for (const time of [0.25, 0.75, 1.25, 1.75]) {
      const frame = (await sink.getCanvas(time))!;
      const c = frame.canvas;
      frames.push({
        timestamp: frame.timestamp,
        colors: [
          [0.25, 0.25],
          [0.75, 0.25],
          [0.25, 0.75],
          [0.75, 0.75],
        ].map(([x, y]) =>
          Array.from(
            c
              .getContext('2d')!
              .getImageData(Math.round(c.width * x), Math.round(c.height * y), 1, 1).data,
          ),
        ),
      });
    }
    let sum = 0,
      count = 0;
    for await (const sample of new AudioSampleSink(audio).samples()) {
      try {
        const data = new Float32Array(sample.numberOfFrames);
        sample.copyTo(data, { planeIndex: 0, format: 'f32-planar' });
        for (let i = 0; i < data.length; i += 16) {
          sum += data[i] ** 2;
          count++;
        }
      } finally {
        sample.close();
      }
    }
    return {
      width: video.displayWidth,
      height: video.displayHeight,
      codec: video.codec,
      audioCodec: audio.codec,
      duration: await input.computeDuration(),
      videoDuration: await video.computeDuration(),
      audioDuration: await audio.computeDuration(),
      rms: Math.sqrt(sum / count),
      frames,
    };
  } finally {
    input.dispose();
  }
}
