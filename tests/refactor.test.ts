import { describe, expect, it } from 'vitest';
import {
  activeTracks,
  addAsset,
  clipDefaults,
  emptyProject,
  layers,
  requiredAssets,
  split,
  trim,
  tick,
  validateProject,
  type Asset,
} from '../src/model';
import { changeSpeed, groupClips } from '../src/editing';
import { setRatio } from '../src/geometry';

const asset: Asset = {
  id: 'source',
  name: 'source.mp4',
  kind: 'video',
  size: 100,
  lastModified: 0,
  duration: tick(10),
  width: 320,
  height: 180,
  container: 'MP4',
  hasAudio: true,
  videoStart: 0,
  audioStart: 0,
  stored: false,
};
function fixture() {
  return addAsset(emptyProject(), structuredClone(asset), 0);
}
function lockedGroup() {
  let p = fixture();
  p.clips.push({
    ...clipDefaults(),
    id: 'title',
    kind: 'text',
    name: '제목',
    trackId: p.tracks[0].id,
    start: tick(12),
    duration: tick(2),
    sourceIn: 0,
    text: {
      text: '한글',
      size: 32,
      color: '#fff',
      bold: false,
      align: 'center',
      outline: 1,
      shadow: false,
      background: 'transparent',
    },
  });
  p = groupClips(
    p,
    p.clips.map((c) => c.id),
  );
  p.tracks[0].locked = true;
  return p;
}
describe('refactor regressions', () => {
  it('does not partly split a group whose off-range member is locked', () => {
    const p = lockedGroup();
    expect(split(p, [p.clips.find((c) => c.kind === 'video')!.id], tick(2))).toBe(p);
  });
  it('does not change speed while a grouped title track is locked', () => {
    const p = lockedGroup();
    expect(changeSpeed(p, [p.clips[0].id], 2)).toBe(p);
  });
  it('rejects a split shorter than one output frame without overlapping clips', () => {
    const p = fixture();
    expect(split(p, [p.clips[0].id], 1)).toBe(p);
    expect(split(p, [p.clips[0].id], asset.duration - 1)).toBe(p);
  });
  it('keeps ratio changes inside the same persisted dimension limit', () => {
    const p = { ...emptyProject(), width: 1920, height: 1920 };
    for (const ratio of ['16:9', '9:16', '1:1', '4:5', '4:3'] as const) {
      const next = setRatio(p, ratio, 1920);
      expect(() => validateProject(next)).not.toThrow();
    }
    expect(setRatio(p, '16:9', 720)).toMatchObject({ width: 1280, height: 720 });
  });
  it.each([
    ['width', undefined],
    ['height', NaN],
    ['videoStart', undefined],
    ['audioStart', Infinity],
    ['hasAudio', 'yes'],
    ['stored', null],
    ['size', -1],
  ])('rejects invalid source field %s before rendering or persistence', (key, value) => {
    const p = fixture();
    Object.assign(p.assets[0], { [key]: value });
    expect(() => validateProject(p)).toThrow();
  });
  it('rejects a visual clip in an audio track and a video reference to an image', () => {
    const p = fixture();
    p.clips.find((c) => c.kind === 'video')!.trackId = p.tracks[2].id;
    expect(() => validateProject(p)).toThrow();
    const other = fixture();
    other.assets[0].kind = 'image';
    expect(() => validateProject(other)).toThrow();
  });
  it('rejects broken text styles but accepts legacy optional project fields', () => {
    const p = lockedGroup();
    const title = p.clips.find((c) => c.kind === 'text')!;
    Object.assign(title.text!, { outline: undefined });
    expect(() => validateProject(p)).toThrow();
    const legacy = fixture();
    expect(validateProject(legacy)).toEqual(legacy);
  });
  it('shares solo/hide/mute rules for layers and required visual/audio sources', () => {
    const p = fixture();
    expect(activeTracks(p, 'audio').size).toBe(2);
    p.tracks[3].solo = true;
    expect(requiredAssets(p, 0, tick(1), false).size).toBe(0);
    expect(layers(p, 0)).toHaveLength(1);
    p.tracks[1].solo = true;
    expect(layers(p, 0)).toHaveLength(1);
    p.tracks[1].hidden = true;
    expect(layers(p, 0)).toHaveLength(0);
    expect(requiredAssets(p, 0, tick(1)).size).toBe(0);
    p.tracks[3].muted = true;
    expect(activeTracks(p, 'audio').size).toBe(0);
  });
  it('preserves integer/source bounds across speed, split and trim combinations', () => {
    for (const speed of [0.5, 0.75, 1, 1.25, 1.5, 2]) {
      let p = fixture();
      p = changeSpeed(p, [p.clips[0].id], speed);
      p = split(p, [p.clips[0].id], 1234567);
      for (const edge of ['start', 'end'] as const)
        for (const delta of [-1234567, 1234567, -100000000, 100000000]) {
          const result = trim(p, [p.clips[0].id], edge, delta);
          expect(() => validateProject(result), `${speed}× ${edge} ${delta}`).not.toThrow();
        }
    }
  });
});
