import {
  Output,
  BufferTarget,
  Mp4OutputFormat,
  Mp3OutputFormat,
  WebMOutputFormat,
  CanvasSource,
  AudioSampleSource,
  AudioSample,
  Input,
  BlobSource,
  ALL_FORMATS,
  Conversion,
} from 'mediabunny';
export async function makeFixtures() {
  const result: { name: string; mimeType: string; bytes: number[] }[] = [];
  for (const [index, name] of ['first.mp4', 'second.mp4'].entries()) {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 180;
    const ctx = canvas.getContext('2d')!;
    const target = new BufferTarget();
    const output = new Output({ target, format: new Mp4OutputFormat() });
    const video = new CanvasSource(canvas, { codec: 'avc', bitrate: 350000, keyFrameInterval: 1 });
    const audio = new AudioSampleSource({ codec: 'aac', bitrate: 96000 });
    output.addVideoTrack(video, { frameRate: 30 });
    output.addAudioTrack(audio);
    await output.start();
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = index ? '#245fbe' : '#c63e32';
      ctx.fillRect(0, 0, 320, 180);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(i * 4, 30, 25, 120);
      await video.add(i / 30, 1 / 30);
      const data = new Float32Array(1600 * 2);
      for (let j = 0; j < 1600; j++) {
        const value = Math.sin(((i * 1600 + j) / 48000) * Math.PI * 2 * (index ? 660 : 440)) * 0.12;
        data[j * 2] = data[j * 2 + 1] = value;
      }
      const sample = new AudioSample({
        data,
        format: 'f32',
        sampleRate: 48000,
        numberOfChannels: 2,
        timestamp: i / 30,
      });
      await audio.add(sample);
      sample.close();
    }
    video.close();
    audio.close();
    await output.finalize();
    result.push({ name, mimeType: 'video/mp4', bytes: Array.from(new Uint8Array(target.buffer!)) });
  }
  const image = document.createElement('canvas');
  image.width = 160;
  image.height = 90;
  const ctx = image.getContext('2d')!;
  ctx.fillStyle = '#f4c64a';
  ctx.fillRect(0, 0, 80, 90);
  const blob = await new Promise<Blob>((r) => image.toBlob((b) => r(b!), 'image/png'));
  result.push({
    name: 'overlay.png',
    mimeType: 'image/png',
    bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
  });
  const rate = 48000,
    count = rate * 6,
    buffer = new ArrayBuffer(44 + count * 2),
    view = new DataView(buffer);
  const str = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i));
  };
  str(0, 'RIFF');
  view.setUint32(4, 36 + count * 2, true);
  str(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i++)
    view.setInt16(44 + i * 2, Math.sin((i / rate) * Math.PI * 2 * 220) * 0.15 * 32767, true);
  result.push({
    name: 'music.wav',
    mimeType: 'audio/wav',
    bytes: Array.from(new Uint8Array(buffer)),
  });
  return result;
}
export async function makeCompatibilityFixtures() {
  const base = await makeFixtures();
  const { registerMp3Encoder } = await import('@mediabunny/mp3-encoder');
  registerMp3Encoder();
  const results: { name: string; mimeType: string; bytes: number[] }[] = [];
  for (const [name, source, format] of [
    ['sound.mp3', base[3], new Mp3OutputFormat()],
    ['movie.webm', base[0], new WebMOutputFormat()],
  ] as const) {
    const input = new Input({
        source: new BlobSource(new Blob([new Uint8Array(source.bytes)])),
        formats: ALL_FORMATS,
      }),
      target = new BufferTarget(),
      output = new Output({ target, format });
    try {
      const conversion = await Conversion.init({
        input,
        output,
        ...(name.endsWith('webm')
          ? { video: { codec: 'vp8' as const }, audio: { codec: 'opus' as const } }
          : {}),
      });
      await conversion.execute();
      results.push({
        name,
        mimeType: name.endsWith('mp3') ? 'audio/mpeg' : 'video/webm',
        bytes: Array.from(new Uint8Array(target.buffer!)),
      });
    } finally {
      input.dispose();
    }
  }
  return results;
}
export async function makeVfrFixture() {
  const times = [0, 0.041, 0.093, 0.145, 0.25, 0.365, 0.49, 0.68, 0.87, 1.08, 1.3];
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 180;
  const target = new BufferTarget(),
    output = new Output({ target, format: new Mp4OutputFormat() }),
    source = new CanvasSource(canvas, { codec: 'avc', bitrate: 300000 });
  output.addVideoTrack(source);
  await output.start();
  const ctx = canvas.getContext('2d')!;
  for (let i = 0; i < times.length - 1; i++) {
    ctx.fillStyle = i % 2 ? '#1e4bb4' : '#c83232';
    ctx.fillRect(0, 0, 320, 180);
    await source.add(times[i], times[i + 1] - times[i]);
  }
  source.close();
  await output.finalize();
  return {
    name: 'vfr.mp4',
    mimeType: 'video/mp4',
    bytes: Array.from(new Uint8Array(target.buffer!)),
    times,
  };
}
