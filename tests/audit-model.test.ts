import { it, expect } from 'vitest';
import {
  emptyProject,
  tick,
  addAsset,
  move,
  split,
  paste,
  linked,
  validateProject,
  clipDefaults,
  requiredAssets,
  setTransition,
  type Asset,
} from '../src/model';
import { fitPreview } from '../src/geometry';
import {
  parseTimecode,
  trimToHead,
  deleteGap,
  groupClips,
  freeLayer,
  markRange,
  changeSpeed,
  insertMedia,
} from '../src/editing';
import { parseCaptions, serializeCaptions, addCaptions } from '../src/captions';
const asset: Asset = {
  id: 'a',
  name: 'a.mp4',
  kind: 'video',
  size: 1,
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
  return addAsset(emptyProject(), asset, 0);
}
it('fits portrait and landscape to both available dimensions without collapsing', () => {
  for (const aspect of [16 / 9, 9 / 16, 1, 4 / 5, 4 / 3]) {
    const size = fitPreview(718, 404, aspect);
    expect(size.width).toBeGreaterThan(0);
    expect(size.height).toBeGreaterThan(0);
    expect(size.width).toBeLessThanOrEqual(718);
    expect(size.height).toBeLessThanOrEqual(404);
    expect(size.width / size.height).toBeCloseTo(aspect, 10);
  }
  expect(fitPreview(0, 0, 9 / 16).width).toBeGreaterThan(0);
});
it('parses frame-accurate timecode without silently accepting an invalid frame', () => {
  expect(parseTimecode('00:01:02:15', 30)).toBe(tick(62.5));
  expect(parseTimecode('1:02.5', 30)).toBe(tick(62.5));
  expect(() => parseTimecode('00:00:00:30', 30)).toThrow();
  expect(() => parseTimecode('00:61:00:00', 30)).toThrow();
  expect(() => parseTimecode('-1', 30)).toThrow();
});
it('trims at playhead with linked audio and rejects locked linked tracks', () => {
  const p = fixture(),
    v = p.clips.find((c) => c.kind === 'video')!;
  const trimmed = trimToHead(p, [v.id], tick(2), 'start');
  expect(
    linked(trimmed, [v.id]).every(
      (c) => c.start === tick(2) && c.sourceIn === tick(2) && c.duration === tick(8),
    ),
  ).toBe(true);
  p.tracks.find((t) => t.id === p.clips.find((c) => c.kind === 'audio')!.trackId)!.locked = true;
  expect(trimToHead(p, [v.id], tick(2), 'start')).toBe(p);
});
it('removes an active-track gap with crossing music split and source range preserved', () => {
  let p = fixture();
  p = split(p, [p.clips.find((c) => c.kind === 'video')!.id], tick(3));
  const right = p.clips.find((c) => c.kind === 'video' && c.start === tick(3))!;
  p = move(p, [right.id], tick(2));
  const music = {
    id: 'm',
    kind: 'audio' as const,
    name: 'music',
    trackId: p.tracks.at(-1)!.id,
    assetId: asset.id,
    start: 0,
    duration: tick(10),
    sourceIn: 0,
    ...clipDefaults(),
  };
  p.clips.push(music);
  const result = deleteGap(p, tick(4), right.trackId);
  expect(result.error).toBeUndefined();
  expect(result.project.clips.find((c) => c.id === right.id)!.start).toBe(tick(3));
  const segments = result.project.clips.filter((c) => c.name === 'music');
  expect(segments.map((c) => [c.start, c.duration, c.sourceIn])).toEqual([
    [0, tick(3), 0],
    [tick(3), tick(5), tick(5)],
  ]);
  expect(() => validateProject(result.project)).not.toThrow();
  p.tracks.at(-1)!.locked = true;
  expect(deleteGap(p, tick(4), right.trackId).project).toBe(p);
});
it('copies groups without coupling the duplicate to original members', () => {
  let p = fixture();
  p = split(p, [p.clips.find((c) => c.kind === 'video')!.id], tick(3));
  p = groupClips(
    p,
    p.clips.map((c) => c.id),
  );
  expect(linked(p, [p.clips[0].id])).toHaveLength(4);
  const next = paste(p, linked(p, [p.clips[0].id]), tick(12));
  const added = next.clips.filter((c) => !p.clips.some((x) => x.id === c.id));
  expect(new Set(added.map((c) => c.groupId)).size).toBe(1);
  expect(added[0].groupId).not.toBe(p.clips[0].groupId);
  expect(linked(next, [added[0].id])).toHaveLength(4);
});
it('puts intersecting overlays on separate layers and round trips Korean SRT/VTT', () => {
  const cues = parseCaptions(
    '1\n00:00:01,000 --> 00:00:02,500\n한글\n두 줄\n\n2\n00:00:02,000 --> 00:00:03,000\n겹친 자막',
  );
  const p = addCaptions(emptyProject(), cues);
  expect(p.clips[0].trackId).not.toBe(p.clips[1].trackId);
  expect(parseCaptions(serializeCaptions(p.clips, 'srt'))).toEqual(cues);
  expect(parseCaptions(serializeCaptions(p.clips, 'vtt'))).toEqual(cues);
  expect(freeLayer(p, tick(1), tick(2), '텍스트').track.id).not.toBe(p.clips[0].trackId);
  expect(() => parseCaptions('1\n00:00:03,000 --> 00:00:02,000\n잘못된 범위')).toThrow();
});
it('keeps I/O range ordered and serialized', () => {
  let p = fixture();
  p = markRange(p, tick(3), 'start');
  p = markRange(p, tick(2), 'end');
  expect(p.workRange).toEqual({ start: tick(2), end: tick(2) });
  expect(validateProject(p).workRange).toEqual(p.workRange);
});
it('changes linked speed without changing source range, including split and trim', () => {
  let p = fixture();
  const v = p.clips.find((c) => c.kind === 'video')!;
  p = changeSpeed(p, [v.id], 2);
  expect(p.clips.every((c) => c.duration === tick(5) && c.speed === 2)).toBe(true);
  p = split(p, [v.id], tick(2));
  expect(p.clips.filter((c) => c.start === tick(2)).every((c) => c.sourceIn === tick(4))).toBe(
    true,
  );
  p = trimToHead(p, [v.id], tick(1), 'start');
  expect(p.clips.find((c) => c.id === v.id)!.sourceIn).toBe(tick(2));
  expect(() => validateProject(p)).not.toThrow();
  p.tracks.find((t) => t.id === p.clips.find((c) => c.kind === 'audio')!.trackId)!.locked = true;
  expect(changeSpeed(p, [v.id], 0.5)).toBe(p);
});
it('keeps previous snapshots immutable while changing speed and source handles', () => {
  let p = fixture();
  p = split(p, [p.clips.find((c) => c.kind === 'video')!.id], tick(5));
  const c = p.clips.find((c) => c.kind === 'video' && c.start === tick(5))!;
  p = setTransition(p, c.id, 'dissolve', tick(2)).project;
  const before = JSON.stringify(p);
  changeSpeed(p, [c.id], 2);
  expect(JSON.stringify(p)).toBe(before);
});
it('requires dissolve source handles but skips hidden visual sources and audio-only output', () => {
  let p = addAsset(emptyProject(), { ...asset, hasAudio: false }, 0);
  p = addAsset(p, { ...asset, id: 'b', hasAudio: false }, tick(10));
  p.clips.find((c) => c.assetId === 'b')!.sourceIn = tick(2);
  p.clips.find((c) => c.assetId === 'b')!.duration = tick(3);
  const next = p.clips.find((c) => c.assetId === 'b')!;
  p = setTransition(p, next.id, 'dissolve', tick(1)).project;
  expect([...requiredAssets(p, tick(9), tick(9.5))]).toEqual(['a', 'b']);
  expect(requiredAssets(p, tick(9), tick(9.5), false).size).toBe(0);
  p.tracks.find((t) => t.id === next.trackId)!.hidden = true;
  expect(requiredAssets(p, tick(9), tick(9.5)).size).toBe(0);
});
it('preserves locked tracks while allocating a usable track for linked imported audio', () => {
  const p = emptyProject();
  p.tracks.filter((t) => t.kind === 'audio').forEach((t) => (t.locked = true));
  const before = JSON.stringify(p),
    next = insertMedia(p, asset, 0);
  expect(next.clips).toHaveLength(2);
  expect(next.clips.filter((c) => c.linkId)).toHaveLength(2);
  expect(next.tracks.filter((t) => t.kind === 'audio' && t.locked)).toHaveLength(2);
  expect(JSON.stringify(p)).toBe(before);
  expect(() => validateProject(next)).not.toThrow();
});
