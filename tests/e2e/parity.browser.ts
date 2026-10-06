import { Input, BlobSource, ALL_FORMATS, CanvasSink, AudioSampleSink } from 'mediabunny';
import { Renderer } from '../../src/render';
import { MediaPool } from '../../src/media';
import { files } from '../../src/engine';
import { frameTick, type Project } from '../../src/model';
/** The fixtures use distinct tones, so decoded output identifies audio cuts and fade gain. */
export async function audioCuts(bytes: number[]) {
  const input = new Input({
    source: new BlobSource(new Blob([new Uint8Array(bytes)])),
    formats: ALL_FORMATS,
  });
  const rate = 48000,
    times = [1.5, 1.85, 2.1, 2.3, 3.1, 3.6, 4.4, 5.7],
    windows = times.map((time) => ({ time, data: new Float32Array(rate / 10) }));
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error('Missing mixed audio');
    for await (const sample of new AudioSampleSink(track).samples()) {
      if (sample.sampleRate !== rate) throw new Error('Unexpected sample rate');
      const data = new Float32Array(sample.numberOfFrames);
      sample.copyTo(data, { planeIndex: 0, format: 'f32-planar' });
      for (const window of windows) {
        const offset = Math.round((sample.timestamp - window.time) * rate),
          first = Math.max(0, -offset),
          last = Math.min(data.length, window.data.length - offset);
        for (let i = first; i < last; i++) window.data[offset + i] = data[i];
      }
      sample.close();
    }
    return windows.map(({ time, data }) => ({
      time,
      amplitudes: [220, 440, 660].map((hz) => {
        let sin = 0,
          cos = 0,
          weight = 0;
        for (let i = 0; i < data.length; i++) {
          const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (data.length - 1)),
            angle = (2 * Math.PI * hz * i) / rate;
          sin += data[i] * w * Math.sin(angle);
          cos += data[i] * w * Math.cos(angle);
          weight += w;
        }
        return (2 * Math.hypot(sin, cos)) / weight;
      }),
    }));
  } finally {
    input.dispose();
  }
}
/** Compare actual decoded export pixels to the common compositor; additionally inspect clip-boundary colors. */
export async function compareOutput(
  project: Project,
  bytes: number[],
  sources?: { id: string; file: File }[],
) {
  const pool = new MediaPool();
  // A separate analyzer page should receive its own originals rather than
  // mutating the live editor's file map during asynchronous restoration/HMR.
  if (sources) for (const { id, file } of sources) pool.register(id, file);
  else for (const [key, file] of files) pool.register(key, file);
  const input = new Input({
    source: new BlobSource(new Blob([new Uint8Array(bytes)])),
    formats: ALL_FORMATS,
  });
  const canvas = new OffscreenCanvas(project.width, project.height);
  const renderer = new Renderer(pool, canvas);
  const results: { time: number; mae: number; color: number[] }[] = [];
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('Output missing video');
    const sink = new CanvasSink(track, { poolSize: 1 });
    for (const time of [0.5, 1.5, 2.25, 2.6, 3.2, 5.8]) {
      await renderer.render(project, frameTick(Math.floor(time * project.fps), project.fps));
      const reference = canvas
        .getContext('2d')!
        .getImageData(0, 0, canvas.width, canvas.height).data;
      const frame = await sink.getCanvas(time);
      if (!frame) throw new Error('Output missing frame');
      const actual = frame.canvas
        .getContext('2d')!
        .getImageData(0, 0, canvas.width, canvas.height).data;
      let total = 0,
        count = 0;
      for (let i = 0; i < actual.length; i += 16)
        for (let c = 0; c < 3; c++) {
          total += Math.abs(actual[i + c] - reference[i + c]);
          count++;
        }
      const pixel =
        (Math.round(canvas.height * 0.7) * canvas.width + Math.round(canvas.width * 0.7)) * 4;
      results.push({ time, mae: total / count, color: Array.from(actual.slice(pixel, pixel + 4)) });
    }
    return results;
  } finally {
    input.dispose();
    await renderer.close();
    pool.close();
  }
}
