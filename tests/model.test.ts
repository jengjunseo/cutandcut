import { describe, it, expect } from 'vitest';
import {
  emptyProject,
  clipDefaults,
  tick,
  frameTick,
  timecode,
  addAsset,
  split,
  trim,
  move,
  remove,
  paste,
  linked,
  reorder,
  setTransition,
  layers,
  validateProject,
  type Asset,
} from '../src/model';
import { History } from '../src/history';
const asset: Asset = {
  id: 'source',
  name: 'clip.mp4',
  kind: 'video',
  size: 100,
  lastModified: 1,
  duration: tick(10),
  width: 1280,
  height: 720,
  container: 'MP4',
  videoCodec: 'avc',
  audioCodec: 'aac',
  hasAudio: true,
  videoStart: 0,
  audioStart: 0,
  stored: false,
};
const project = () => {
  const p = emptyProject();
  return addAsset(p, asset, 0, p.tracks[1].id);
};
describe('integer time and linked edits', () => {
  it('uses rational frame timestamps without accumulating fractional error', () => {
    expect(frameTick(30 * 60 * 60, 30)).toBe(tick(3600));
    expect(frameTick(60 * 60 * 60, 60)).toBe(tick(3600));
    expect(frameTick(24, 24)).toBe(tick(1));
  });
  it('displays rounded microsecond frame boundaries without losing a frame', () => {
    expect(timecode(frameTick(1, 30), 30)).toBe('00:00:00:01');
    expect(timecode(frameTick(4, 30), 30)).toBe('00:00:00:04');
    expect(timecode(tick(0.025), 30)).toBe('00:00:00:00');
    expect(timecode(frameTick(59, 60), 60)).toBe('00:00:00:59');
  });
  it('splits picture and linked sound at exactly the same original time', () => {
    const p = project(),
      c = p.clips.find((c) => c.kind === 'video')!;
    const next = split(p, [c.id], tick(3));
    expect(next.clips).toHaveLength(4);
    const right = next.clips.filter((c) => c.start === tick(3));
    expect(right.map((c) => c.sourceIn)).toEqual([tick(3), tick(3)]);
    expect(right[0].linkId).toBe(right[1].linkId);
    expect(right[0].linkId).not.toBe(c.linkId);
    expect(p.clips[0].duration).toBe(tick(10));
  });
  it('clamps trims to original bounds and at least one output frame', () => {
    const p = project(),
      c = p.clips.find((c) => c.kind === 'video')!;
    const start = trim(p, [c.id], 'start', -tick(50));
    expect(start.clips.every((c) => c.sourceIn === 0)).toBe(true);
    const end = trim(p, [c.id], 'end', -tick(50));
    expect(end.clips.every((c) => c.duration === frameTick(1, p.fps))).toBe(true);
    const extended = trim(p, [c.id], 'end', tick(50));
    expect(extended.clips.every((c) => c.duration === asset.duration)).toBe(true);
  });
  it('blocks picture edits when its linked audio track is locked', () => {
    const p = project();
    p.tracks[2].locked = true;
    const c = p.clips.find((c) => c.kind === 'video')!;
    expect(move(p, [c.id], tick(2))).toBe(p);
    expect(trim(p, [c.id], 'start', tick(2))).toBe(p);
    expect(split(p, [c.id], tick(2))).toBe(p);
  });
  it('moves multiselection together and clamps the whole group at zero', () => {
    let p = project();
    p = split(p, [p.clips.find((c) => c.kind === 'video')!.id], tick(3));
    const targets = p.clips.filter((c) => c.kind === 'video');
    const next = move(
      p,
      targets.map((c) => c.id),
      -tick(50),
    );
    expect(next.clips.map((c) => c.start).sort()).toEqual(p.clips.map((c) => c.start).sort());
  });
  it('swaps neighboring unequal clips and their linked audio in one edit', () => {
    let p = project();
    p = split(p, [p.clips.find((c) => c.kind === 'video')!.id], tick(3));
    const first = p.clips.find((c) => c.kind === 'video' && c.start === 0)!;
    const result = reorder(p, first.id, 1);
    expect(result.error).toBeUndefined();
    expect(
      result.project.clips.filter((c) => c.sourceIn === 0).every((c) => c.start === tick(7)),
    ).toBe(true);
    expect(
      result.project.clips.filter((c) => c.sourceIn === tick(3)).every((c) => c.start === 0),
    ).toBe(true);
  });
});
describe('ripple synchronization', () => {
  it('normal deletion keeps the following start unchanged; ripple closes time once for linked pairs', () => {
    let p = project();
    p = addAsset(p, { ...asset, id: 'second' }, tick(10), p.tracks[1].id);
    const chosen = p.clips.find((c) => c.assetId === 'source' && c.kind === 'video')!.id;
    expect(remove(p, [chosen]).project.clips.every((c) => c.start === tick(10))).toBe(true);
    expect(remove(p, [chosen], true).project.clips.every((c) => c.start === 0)).toBe(true);
  });
  it('rejects ripple if a later locked track would shift', () => {
    let p = project();
    const t = p.tracks[3];
    p.clips.push({
      id: 'later',
      kind: 'audio',
      trackId: t.id,
      assetId: asset.id,
      name: 'later',
      start: tick(12),
      duration: tick(1),
      sourceIn: 0,
      ...clipDefaults(),
    });
    t.locked = true;
    const c = p.clips.find((c) => c.kind === 'video')!;
    const result = remove(p, [c.id], true);
    expect(result.project).toBe(p);
    expect(result.error).toContain('잠긴');
  });
  it('rejects ripple across an unselected overlay that straddles the removed interval', () => {
    const p = project();
    p.clips.push({
      id: 'overlay',
      kind: 'text',
      trackId: p.tracks[0].id,
      name: 'caption',
      start: tick(5),
      duration: tick(7),
      sourceIn: 0,
      ...clipDefaults(),
      text: {
        text: '한글',
        size: 40,
        color: '#fff',
        bold: false,
        align: 'center',
        outline: 0,
        shadow: false,
        background: 'transparent',
      },
    });
    expect(remove(p, [p.clips[0].id], true).project).toBe(p);
  });
});
describe('history, copy and transitions', () => {
  it('restores the exact edit model in undo and redo without mutating original', () => {
    const h = new History(),
      p = project(),
      next = move(p, [p.clips[0].id], tick(1));
    const current = h.commit(p, next);
    expect(h.undo(current)).toEqual(p);
    expect(h.redo(p)).toEqual(next);
    expect(h.past).toHaveLength(1);
    h.undo(next);
    h.commit(p, trim(p, [p.clips[0].id], 'end', -tick(1)));
    expect(h.future).toHaveLength(0);
  });
  it('paste renews link groups and puts the multitrack group at the playhead', () => {
    const p = project(),
      copy = linked(p, [p.clips[0].id]);
    const next = paste(p, copy, tick(12), p.tracks[0].id);
    const added = next.clips.slice(2);
    expect(added.every((c) => c.start === tick(12))).toBe(true);
    expect(added[0].linkId).toBe(added[1].linkId);
    expect(added[0].linkId).not.toBe(copy[0].linkId);
    expect(added[0].trackId).toBe(copy[0].trackId);
  });
  it('cross dissolve requires original handles and keeps timeline duration unchanged', () => {
    let p = project();
    p = split(p, [p.clips.find((c) => c.kind === 'video')!.id], tick(5));
    const right = p.clips.find((c) => c.kind === 'video' && c.start === tick(5))!;
    const result = setTransition(p, right.id, 'dissolve', tick(1));
    expect(result.project.clips.find((c) => c.id === right.id)!.transition?.duration).toBe(tick(1));
    const frame = layers(result.project, tick(4.5));
    expect(frame).toHaveLength(2);
    expect(frame[1].alpha).toBe(0.5);
    expect(frame[1].sourceTime).toBe(4.5);
    expect(result.project.clips.map((c) => c.duration)).toEqual(p.clips.map((c) => c.duration));
  });
  it('validates serialized projects and refuses out-of-range sources', () => {
    const p = project();
    expect(validateProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
    p.clips[0].sourceIn = tick(12);
    expect(() => validateProject(p)).toThrow();
  });
});
