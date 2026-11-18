import {
  emptyProject,
  clipDefaults,
  tick,
  type Project,
  type Asset,
  type Clip,
} from '../src/model';
import { generateBenchmark } from './benchmark.browser';
import { setTransitionV2 } from '../src/transitions';
export async function directiveFixtures() {
  const result: { name: string; bytes: number[]; mimeType: string }[] = [];
  for (const fps of [30, 60])
    result.push({
      name: `synthetic-1080-${fps}.mp4`,
      bytes: await generateBenchmark(1920, 1080, 64, fps),
      mimeType: 'video/mp4',
    });
  const canvas = new OffscreenCanvas(240, 160),
    ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(30,180,160,.6)';
  ctx.fillRect(0, 0, 240, 160);
  result.push({
    name: 'overlay.png',
    bytes: Array.from(new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer())),
    mimeType: 'image/png',
  });
  return result;
}
export function directiveProject(scenario: string, assets: Asset[]): Project {
  const p = emptyProject();
  p.name = scenario;
  p.width = 1920;
  p.height = 1080;
  p.fps = scenario === 'B4' ? 60 : 30;
  p.assets = assets;
  const source = assets.find((a) => a.name.includes(`${p.fps}.mp4`))!;
  const count = scenario === 'B2' ? 5 : scenario === 'B3' ? 5 : 1,
    span = scenario === 'B2' ? 12 : 60;
  for (let i = 0; i < count; i++) {
    const linkId = `link-${i}`;
    const c: Clip = {
      ...clipDefaults(),
      id: `video-${i}`,
      kind: 'video',
      name: 'fixture',
      assetId: source.id,
      trackId: p.tracks[1].id,
      start: tick(i * span),
      duration: tick(span),
      sourceIn: tick(scenario === 'B2' ? 1 + i * span : 1),
      linkId,
    };
    if (scenario === 'B2' && i)
      c.transition = {
        kind: i === 2 ? 'black' : i === 3 ? 'white' : 'dissolve',
        duration: tick(0.2),
      };
    p.clips.push(c, {
      ...c,
      id: `audio-${i}`,
      kind: 'audio',
      trackId: p.tracks[2].id,
      transition: undefined,
    });
  }
  const captions = scenario === 'B3' ? 100 : scenario === 'B2' ? 20 : 0;
  for (let i = 0; i < captions; i++)
    p.clips.push({
      ...clipDefaults(),
      id: `text-${i}`,
      kind: 'text',
      name: 'caption',
      textRole: 'caption',
      trackId: p.tracks[0].id,
      start: tick(i * (scenario === 'B3' ? 3 : 3)),
      duration: tick(2.8),
      sourceIn: 0,
      y: 0.82,
      text: {
        text: `한글 자막 ${i + 1}\n동일 품질 출력 검사`,
        size: 48,
        color: '#fff',
        bold: false,
        align: 'center',
        outline: 2,
        shadow: true,
        background: 'transparent',
      },
    });
  if (scenario === 'B2') {
    const image = assets.find((a) => a.kind === 'image')!;
    for (let i = 0; i < 5; i++)
      p.clips.push({
        ...clipDefaults(),
        id: `image-${i}`,
        kind: 'image',
        name: 'overlay',
        trackId: p.tracks[0].id,
        assetId: image.id,
        start: tick(i * 12),
        duration: tick(4),
        sourceIn: 0,
        scale: 0.2,
        y: 0.25,
      });
    p.clips.push({
      ...p.clips[1],
      id: 'music',
      linkId: undefined,
      trackId: p.tracks[3].id,
      start: 0,
      duration: tick(60),
      volume: 0.15,
    });
  }
  return p;
}
export function directiveProjectV2(assets: Asset[]) {
  let p = directiveProject('B2', assets);
  p.name = 'B2-v2';
  p.clips = p.clips.map((c) => ({ ...c, transition: undefined }));
  for (const [i, kind] of (['dissolve', 'black', 'slide', 'wipe'] as const).entries())
    p = setTransitionV2(p, `video-${i + 1}`, kind, tick(0.4)).project;
  return p;
}
