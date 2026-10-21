import {
  Output,
  BufferTarget,
  Mp4OutputFormat,
  CanvasSource,
  Input,
  BlobSource,
  ALL_FORMATS,
  CanvasSink,
} from 'mediabunny';
import { emptyProject, addAsset, clipDefaults, tick } from '../../src/model';
import { inspect } from '../../src/engine';
import { saveProject, saveFile } from '../../src/storage';

export const swatches = ['#202020', '#808080', '#e0e0e0', '#b74932', '#398058', '#426bb5'];

/** A real SDR color chart, including neutral patches that reveal a blue cast. */
export async function seedColorProject() {
  const canvas = new OffscreenCanvas(640, 360);
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' })!;
  swatches.forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.fillRect(((i % 3) * 640) / 3, Math.floor(i / 3) * 180, 640 / 3 + 1, 180);
  });
  const target = new BufferTarget();
  const output = new Output({ target, format: new Mp4OutputFormat() });
  const video = new CanvasSource(canvas, { codec: 'avc', bitrate: 2_000_000 });
  output.addVideoTrack(video, { frameRate: 30 });
  await output.start();
  for (let i = 0; i < 30; i++) await video.add(i / 30, 1 / 30);
  video.close();
  await output.finalize();
  const file = new File([target.buffer!], 'sdr-chart.mp4', { type: 'video/mp4' });
  const asset = await inspect(file);
  asset.stored = true;
  await saveFile(asset.id, file);
  let project = addAsset(emptyProject(), asset, 0);
  const image = new OffscreenCanvas(64, 64);
  const imageContext = image.getContext('2d')!;
  imageContext.fillStyle = '#f0b04080';
  imageContext.fillRect(12, 12, 40, 40);
  const png = new File([await image.convertToBlob()], 'alpha-overlay.png', { type: 'image/png' });
  const imageAsset = await inspect(png);
  imageAsset.stored = true;
  await saveFile(imageAsset.id, png);
  const imageTrack = { ...project.tracks[0], id: crypto.randomUUID(), name: '알파 이미지' };
  project.tracks.splice(1, 0, imageTrack);
  project = addAsset(project, imageAsset, 0, imageTrack.id);
  const imageClip = project.clips.find((c) => c.kind === 'image')!;
  Object.assign(imageClip, {
    duration: tick(1),
    scale: 0.15,
    x: 0.75,
    y: 0.5,
    opacity: 0.65,
    rotation: 15,
  });
  project.clips.push({
    ...clipDefaults(),
    id: crypto.randomUUID(),
    kind: 'text',
    name: '색상 검사',
    trackId: project.tracks[0].id,
    start: 0,
    duration: tick(1),
    sourceIn: 0,
    y: 0.5,
    text: {
      text: '한글 자막 · 같은 화면',
      size: 56,
      bold: true,
      align: 'center',
      color: '#ffffff',
      outline: 2,
      shadow: true,
      background: 'transparent',
    },
  });
  await saveProject(project);
  return project;
}

export function patches(canvas: HTMLCanvasElement | OffscreenCanvas) {
  const ctx = canvas.getContext('2d') as
    CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  return swatches.map((_, i) =>
    Array.from(
      ctx.getImageData(
        Math.floor((canvas.width * ((i % 3) + 0.5)) / 3),
        Math.floor((canvas.height * (Math.floor(i / 3) + 0.5)) / 2),
        1,
        1,
      ).data,
    ),
  );
}

export async function inspectColorOutput(bytes: number[]) {
  const input = new Input({
    source: new BlobSource(new Blob([new Uint8Array(bytes)])),
    formats: ALL_FORMATS,
  });
  try {
    const track = (await input.getPrimaryVideoTrack())!;
    const sink = new CanvasSink(track, { poolSize: 1 });
    const frameHashes: string[] = [];
    for (const time of [0, 0.5, 0.9]) {
      const frame = (await sink.getCanvas(time))!;
      const context = frame.canvas.getContext('2d') as
        CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
      const pixels = context.getImageData(0, 0, frame.canvas.width, frame.canvas.height);
      frameHashes.push(
        Array.from(
          new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(pixels.data))),
        )
          .map((n) => n.toString(16).padStart(2, '0'))
          .join(''),
      );
    }
    const frame = (await sink.getCanvas(0.5))!;
    return {
      width: track.displayWidth,
      height: track.displayHeight,
      duration: await input.computeDuration(),
      colorSpace: await track.getColorSpace(),
      patches: patches(frame.canvas),
      frameHashes,
    };
  } finally {
    input.dispose();
  }
}
