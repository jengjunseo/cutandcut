import { afterEach, expect, it, vi } from 'vitest';
import { Input } from 'mediabunny';
import { MediaPool, type VideoCursor } from '../src/media';
import { Renderer } from '../src/render';
import { addAsset, emptyProject, tick, type Asset } from '../src/model';
vi.mock('../src/fonts', () => ({ ensureFonts: async () => {} }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('disposes uncached Input when demux fails, allowing a clean retry', async () => {
  vi.spyOn(Input.prototype, 'getPrimaryVideoTrack').mockRejectedValue(new Error('demux failed'));
  vi.spyOn(Input.prototype, 'getPrimaryAudioTrack').mockResolvedValue(null);
  const dispose = vi.spyOn(Input.prototype, 'dispose');
  const pool = new MediaPool();
  pool.register('bad', new File(['invalid'], 'bad.mp4'));
  for (let i = 0; i < 2; i++) await expect(pool.get('bad')).rejects.toThrow('demux failed');
  expect(dispose).toHaveBeenCalledTimes(2);
  expect(pool.resources.size).toBe(0);
  pool.close();
  expect(dispose).toHaveBeenCalledTimes(2);
});
it('disposes uncached Input when image decoding fails', async () => {
  vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('image failed')));
  const dispose = vi.spyOn(Input.prototype, 'dispose');
  const pool = new MediaPool();
  pool.register('bad', new File(['invalid'], 'bad.png', { type: 'image/png' }));
  await expect(pool.get('bad')).rejects.toThrow('image failed');
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(pool.resources.size).toBe(0);
  pool.close();
});
it('balances canvas state across repeated failed frame requests', async () => {
  const asset: Asset = {
    id: 'bad',
    name: 'bad.mp4',
    kind: 'video',
    size: 1,
    lastModified: 0,
    duration: tick(1),
    width: 320,
    height: 180,
    container: 'MP4',
    hasAudio: false,
    stored: false,
    videoStart: 0,
    audioStart: 0,
  };
  const project = addAsset(emptyProject(), asset, 0),
    pool = new MediaPool();
  vi.spyOn(pool, 'get').mockRejectedValue(new Error('decode failed'));
  let depth = 0;
  const context = {
    resetTransform() {},
    fillRect() {},
    translate() {},
    rotate() {},
    scale() {},
    save() {
      depth++;
    },
    restore() {
      depth--;
    },
  };
  const canvas = {
    width: 1280,
    height: 720,
    getContext: () => context,
  } as unknown as OffscreenCanvas;
  const renderer = new Renderer(pool, canvas);
  for (let i = 0; i < 2; i++) {
    await expect(renderer.render(project, 0)).rejects.toThrow('decode failed');
    expect(depth).toBe(0);
  }
  await renderer.close();
  pool.close();
});
it('releases ended video cursors before opening the next scene at the cache limit', async () => {
  const pool = new MediaPool();
  const asset: Asset = {
    id: 'next',
    name: 'next.png',
    kind: 'image',
    size: 1,
    lastModified: 0,
    duration: tick(5),
    width: 320,
    height: 180,
    container: 'PNG',
    hasAudio: false,
    stored: false,
    videoStart: 0,
    audioStart: 0,
  };
  const project = addAsset(emptyProject(), asset, 0);
  const context = {
    resetTransform() {},
    fillRect() {},
    translate() {},
    rotate() {},
    scale() {},
    save() {},
    restore() {},
    drawImage() {},
  };
  const canvas = {
    width: 1280,
    height: 720,
    getContext: () => context,
  } as unknown as OffscreenCanvas;
  const renderer = new Renderer(pool, canvas);
  for (let i = 0; i < 12; i++) {
    const key = `ended-${i}`;
    pool.pin(key);
    renderer.cursors.set(key, { assetId: key, close: async () => {} } as unknown as VideoCursor);
  }
  vi.spyOn(pool, 'get').mockImplementation(async () => {
    if (pool.pins.size >= 12) throw new Error('all sources pinned');
    return { input: {} as Input, image: { width: 320, height: 180 } as ImageBitmap };
  });
  await expect(renderer.render(project, 0)).resolves.toBeUndefined();
  expect(pool.pins.size).toBe(0);
  expect(renderer.cursors.size).toBe(0);
  await renderer.close();
  pool.close();
});
