import { describe, expect, it } from 'vitest';
import {
  addAsset,
  emptyProject,
  linked,
  tick,
  trim,
  validateProject,
  paste,
  clipDefaults,
  type Clip,
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
  function caption(p: ReturnType<typeof fixture>): Clip {
    return {
      ...clipDefaults(),
      id: 'caption',
      trackId: p.tracks[0].id,
      kind: 'text',
      textRole: 'caption',
      name: '한글 자막',
      start: 0,
      duration: tick(2),
      sourceIn: 0,
      text: {
        text: '영상 위의 자막\n두 번째 줄',
        size: 48,
        color: '#ffffff',
        bold: false,
        align: 'center',
        outline: 2,
        shadow: true,
        background: '',
      },
    };
  }
  it('pastes overlapping captions without cutting, moving or changing existing media', () => {
    const p = fixture();
    p.clips.push(caption(p));
    p.workRange = { start: tick(1), end: tick(8) };
    const original = structuredClone(p);
    // Even if the video track is active, text belongs on a free overlay layer.
    const result = pasteEdit(p, [p.clips[2]], tick(1), p.tracks[1].id);
    expect(result.error).toBeUndefined();
    expect(result.project.clips.filter((c) => !result.inserted!.includes(c.id))).toEqual(p.clips);
    expect(result.project.workRange).toEqual(p.workRange);
    const added = result.project.clips.find((c) => result.inserted!.includes(c.id))!;
    expect(added.start).toBe(tick(1));
    expect(added.text).toEqual(p.clips[2].text);
    expect(added.textRole).toBe('caption');
    expect(added.trackId).not.toBe(p.tracks[1].id);
    expect(added.trackId).not.toBe(p.clips[2].trackId);
    expect(validateProject(result.project)).toEqual(result.project);
    expect(p).toEqual(original);
  });
  it('pastes captions over locked background media without editing it', () => {
    const p = fixture();
    p.clips.push(caption(p));
    p.tracks[1].locked = true;
    p.tracks[2].locked = true;
    const result = pasteEdit(p, [p.clips[2]], tick(4), p.tracks[2].id);
    expect(result.error).toBeUndefined();
    expect(result.project.clips.filter((c) => c.kind !== 'text')).toEqual(p.clips.slice(0, 2));
    expect(result.project.clips.at(-1)!.trackId).toBe(p.tracks[0].id);
  });
  it('pastes grouped captions with relative timing and fresh group IDs, without moving media', () => {
    const p = fixture();
    const first = { ...caption(p), groupId: 'captions' };
    const second = { ...first, id: 'caption-2', start: tick(3) };
    p.clips.push(first, second);
    const result = pasteEdit(p, [first, second], tick(4), p.tracks[1].id);
    expect(result.error).toBeUndefined();
    expect(result.project.clips.filter((c) => !result.inserted!.includes(c.id))).toEqual(p.clips);
    const added = result.project.clips.filter((c) => result.inserted!.includes(c.id));
    expect(added.map((c) => c.start)).toEqual([tick(4), tick(7)]);
    expect(added[0].groupId).not.toBe(first.groupId);
    expect(added[1].groupId).toBe(added[0].groupId);
    expect(validateProject(result.project)).toEqual(result.project);
  });
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
