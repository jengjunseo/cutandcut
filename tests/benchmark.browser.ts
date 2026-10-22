import {
  Output,
  BufferTarget,
  Mp4OutputFormat,
  CanvasSource,
  AudioSampleSource,
  AudioSample,
} from 'mediabunny';

/** Reproducible low-complexity animation + tone. Never presented as camera footage. */
export async function generateBenchmark(width: number, height: number, length: number) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  const target = new BufferTarget();
  const output = new Output({ target, format: new Mp4OutputFormat() });
  const video = new CanvasSource(canvas, { codec: 'avc', bitrate: 2500000, keyFrameInterval: 2 });
  const audio = new AudioSampleSource({ codec: 'aac', bitrate: 96000 });
  output.addVideoTrack(video, { frameRate: 30 });
  output.addAudioTrack(audio);
  await output.start();
  for (let i = 0; i < length * 30; i++) {
    ctx.fillStyle = Math.floor(i / 60) % 2 ? '#385d84' : '#86523b';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#dcdcdc';
    ctx.fillRect((i * 7) % (width - width / 8), height / 3, width / 8, height / 3);
    ctx.fillStyle = '#222222';
    ctx.fillRect(width / 2, (i * 3) % (height - height / 8), width / 8, height / 8);
    await video.add(i / 30, 1 / 30);
    const data = new Float32Array(1600);
    for (let j = 0; j < data.length; j++)
      data[j] = Math.sin(((i * 1600 + j) / 48000) * Math.PI * 2 * 440) * 0.1;
    const sample = new AudioSample({
      data,
      format: 'f32',
      sampleRate: 48000,
      numberOfChannels: 1,
      timestamp: i / 30,
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
  return Array.from(new Uint8Array(target.buffer!));
}
