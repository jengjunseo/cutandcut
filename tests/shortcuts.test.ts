import { describe, expect, it } from 'vitest';
import {
  addAsset,
  emptyProject,
  linked,
  tick,
  trim,
  validateProject,
  paste,
  type Asset,
} from '../src/model';
import { deleteTrack, pasteEdit, groupClips } from '../src/editing';
import { shortcutKey } from '../src/shortcuts';
const source: Asset = {
  id: 'source',
  name: 'video.mp4',
  kind: 'video',
  size: 1,
  lastModified: 1,
  duration: tick(10),
  width: 1280,
  height: 720,
  container: 'MP4',
  hasAudio: true,
  videoStart: 0,
  audioStart: 0,
  stored: false,
};
function fixture() {
  const p = emptyProject();
  return addAsset(p, source, 0, p.tracks[1].id);
}
function copy(p: ReturnType<typeof fixture>) {
  const short = trim(p, [p.clips[0].id], 'end', -tick(8));
  return structuredClone(linked(short, [short.clips[0].id]));
}
describe('Shotcut clipboard and track safety', () => {
  it('uses the physical letter key without changing punctuation', () => {
    expect(shortcutKey({ key: 'ㅊ', code: 'KeyC' })).toBe('c');
    expect(shortcutKey({ key: 'ㄴ', code: 'KeyS' })).toBe('s');
    expect(shortcutKey({ key: '?', code: 'Slash' })).toBe('?');
  });
  it('inserts linked media into a crossing scene and keeps source timing', () => {
    const p = fixture(),
      result = pasteEdit(p, copy(p), tick(2), p.tracks[1].id);
    expect(result.error).toBeUndefined();
    const videos = result.project.clips
      .filter((c) => c.kind === 'video')
      .sort((a, b) => a.start - b.start);
    expect(videos.map((c) => [c.start, c.duration, c.sourceIn])).toEqual([
      [0, tick(2), 0],
      [tick(2), tick(2), 0],
      [tick(4), tick(8), tick(2)],
    ]);
    expect(result.inserted).toHaveLength(2);
    expect(linked(result.project, [videos[2].id])).toHaveLength(2);
    expect(validateProject(result.project)).toEqual(result.project);
    expect(p.clips).toHaveLength(2);
  });
  it('overwrites only the destination and linked tracks without shifting the project', () => {
    const p = fixture(),
      result = pasteEdit(p, copy(p), tick(2), p.tracks[1].id, 'overwrite');
    expect(result.error).toBeUndefined();
    const videos = result.project.clips
      .filter((c) => c.kind === 'video')
      .sort((a, b) => a.start - b.start);
    expect(videos.map((c) => [c.start, c.duration, c.sourceIn])).toEqual([
      [0, tick(2), 0],
      [tick(2), tick(2), 0],
      [tick(4), tick(6), tick(4)],
    ]);
    expect(validateProject(result.project)).toEqual(result.project);
  });
  it('rejects insert/overwrite against a locked linked member atomically', () => {
    const p = fixture(),
      copied = copy(p);
    p.tracks.find((t) => t.kind === 'audio')!.locked = true;
    for (const mode of ['insert', 'overwrite'] as const) {
      const result = pasteEdit(p, copied, tick(2), p.tracks[1].id, mode);
      expect(result.project).toBe(p);
      expect(result.error).toBeTruthy();
    }
  });
  it('rejects a sub-frame boundary without altering the original', () => {
    const p = fixture(),
      result = pasteEdit(p, copy(p), 1, p.tracks[1].id);
    expect(result.project).toBe(p);
    expect(result.error).toBeTruthy();
  });
  it('appends and replaces complete linked selections with fresh link IDs', () => {
    const p = fixture(),
      copied = copy(p);
    const appended = pasteEdit(p, copied, 0, p.tracks[1].id, 'append');
    expect(
      appended.project.clips
        .filter((c) => appended.inserted!.includes(c.id))
        .every((c) => c.start === tick(10)),
    ).toBe(true);
    const replaced = pasteEdit(p, copied, 0, p.tracks[1].id, 'replace', [p.clips[0].id]);
    expect(replaced.project.clips).toHaveLength(2);
    expect(replaced.project.clips[0].duration).toBe(tick(2));
    expect(replaced.project.clips[0].linkId).not.toBe(p.clips[0].linkId);
    expect(validateProject(replaced.project)).toEqual(replaced.project);
  });
  it('pastes copied linked media after its source track was deleted', () => {
    const p = fixture(),
      copied = copy(p),
      deleted = deleteTrack(p, p.tracks[1].id).project;
    const next = paste(deleted, copied, tick(10));
    expect(next.clips).toHaveLength(3);
    expect(next.tracks.some((t) => t.name === '붙여넣기 영상')).toBe(true);
    expect(validateProject(next)).toEqual(next);
  });
  it('track deletion respects an off-track locked group member', () => {
    let p = fixture();
    p = groupClips(
      p,
      p.clips.map((c) => c.id),
    );
    p.tracks.find((t) => t.kind === 'audio')!.locked = true;
    const result = deleteTrack(p, p.tracks[1].id);
    expect(result.project).toBe(p);
    expect(result.error).toBeTruthy();
  });
});
