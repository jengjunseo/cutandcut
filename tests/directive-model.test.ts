import { describe, it, expect } from 'vitest';
import {
  emptyProject,
  clipDefaults,
  tick,
  frameTick,
  layers,
  validateProject,
  setTransition,
  normalize,
  type Clip,
  type Project,
  type Asset,
} from '../src/model';
import { setTransitionV2, transitionWindow, audioEnvelope, envelopeGain } from '../src/transitions';
import { autoNamed, exportStem, safeStem } from '../src/naming';
import { textPresets, styleSnapshot } from '../src/text-styles';
import { graphemes } from '../src/text-layout';
function pair(fps = 30): Project {
  const p = emptyProject();
  p.fps = fps;
  const asset: Asset = {
    id: 'source',
    name: '한글 원본.mp4',
    kind: 'video',
    size: 1000,
    lastModified: 0,
    duration: tick(12),
    width: 1920,
    height: 1080,
    container: 'mp4',
    videoCodec: 'avc',
    audioCodec: 'aac',
    videoStart: 0,
    audioStart: 0,
    hasAudio: true,
    stored: false,
  };
  p.assets = [asset];
  const clip = (id: string, start: number, source: number): Clip => ({
    ...clipDefaults(),
    id,
    name: id,
    assetId: asset.id,
    kind: 'video',
    trackId: p.tracks[1].id,
    start: tick(start),
    duration: tick(2),
    sourceIn: tick(source),
    linkId: id,
  });
  p.clips = [clip('A', 0, 1), clip('B', 2, 4)];
  p.clips.push(
    ...p.clips.map((c) => ({
      ...c,
      id: c.id + '-audio',
      kind: 'audio' as const,
      trackId: p.tracks[2].id,
    })),
  );
  return p;
}
describe('directive transition contracts and compatible serialization', () => {
  for (const fps of [24, 30, 60])
    for (const kind of ['dissolve', 'black', 'slide', 'wipe'] as const)
      it(`${kind} at ${fps}fps uses a centered total frame duration and no timeline shift`, () => {
        const p = pair(fps),
          r = setTransitionV2(p, 'B', kind, tick(0.4), 'left', true).project;
        const b = r.clips.find((c) => c.id === 'B')!,
          w = transitionWindow(b, fps),
          n = Math.round(0.4 * fps);
        expect(b.transition?.duration).toBe(frameTick(n, fps));
        expect(w.start).toBe(tick(2) - frameTick(Math.floor(n / 2), fps));
        expect(w.end).toBe(tick(2) + frameTick(Math.ceil(n / 2), fps));
        expect(r.clips.map((c) => [c.start, c.duration, c.sourceIn])).toEqual(
          p.clips.map((c) => [c.start, c.duration, c.sourceIn]),
        );
        for (const fraction of [0, 0.25, 0.5, 0.75, 0.999]) {
          const visible = layers(r, Math.round(w.start + (w.end - w.start) * fraction));
          expect(visible.length).toBe(kind === 'black' ? 1 : 2);
          expect(visible.every((l) => l.sourceTime >= 0 && l.sourceTime < 12)).toBe(true);
        }
        expect(validateProject(JSON.parse(JSON.stringify(r)))).toEqual(r);
      });
  it('limits missing handles and refuses locked linked audio atomically', () => {
    const p = pair();
    p.clips.filter((c) => c.linkId === 'B').forEach((c) => (c.sourceIn = 0));
    expect(setTransitionV2(p, 'B', 'dissolve', tick(0.4)).project).toBe(p);
    expect(setTransitionV2(p, 'B', 'black', tick(0.4)).project).not.toBe(p);
    p.tracks[2].locked = true;
    expect(setTransitionV2(p, 'B', 'black', tick(0.4), 'left', true).project).toBe(p);
  });
  it('clamps odd frames and adjacent transition windows and preserves legacy white', () => {
    let p = pair(30);
    p = setTransitionV2(p, 'B', 'dissolve', frameTick(11, 30)).project;
    expect(p.clips[1].transition?.frames).toBe(11);
    expect(transitionWindow(p.clips[1], 30).start).toBe(tick(2) - frameTick(5, 30));
    const legacy = setTransition(pair(), 'B', 'white', tick(0.2)).project;
    expect(legacy.clips[1].transition?.version).toBeUndefined();
    expect(layers(legacy, tick(1.9))[0].overlayAlpha).toBeCloseTo(0.5);
    expect(normalize(legacy).clips[1].transition).toEqual({ kind: 'white', duration: tick(0.2) });
  });
  it('links only source audio and extends its window with an equal-power envelope', () => {
    const p = setTransitionV2(pair(), 'B', 'dissolve', tick(0.4), 'left', true).project;
    const a = p.clips.find((c) => c.id === 'A-audio')!,
      b = p.clips.find((c) => c.id === 'B-audio')!;
    const aa = audioEnvelope(p, a),
      bb = audioEnvelope(p, b);
    expect(aa.end).toBe(tick(2.2));
    expect(bb.start).toBe(tick(1.8));
    expect(envelopeGain(aa, tick(2)) ** 2 + envelopeGain(bb, tick(2)) ** 2).toBeCloseTo(1, 10);
    expect(audioEnvelope(p, { ...a, linkId: undefined }).curves).toHaveLength(0);
  });
});
describe('names, graphemes and style-only snapshots', () => {
  it('auto-names only a first placement and never replaces a manually edited legacy name', () => {
    const p = pair(),
      empty = emptyProject(),
      asset = p.assets[0];
    expect(autoNamed(empty, asset).name).toBe('한글 원본');
    expect(autoNamed({ ...empty, name: '내 이름', nameOrigin: 'manual' }, asset).name).toBe(
      '내 이름',
    );
    expect(
      autoNamed({ ...empty, name: '기존 사용자 이름', nameOrigin: undefined }, asset).name,
    ).toBe('기존 사용자 이름');
    expect(autoNamed(p, asset)).toBe(p);
  });
  it('generates unique names per export intent and safe Unicode stems', () => {
    const date = new Date(2026, 10, 18, 19, 30, 15),
      a = exportStem('마이고_라이브', date),
      b = exportStem('마이고_라이브', date);
    expect(a).toContain('마이고_라이브_20261118-193015_');
    expect(a).not.toBe(b);
    const long = '한글👩‍💻'.repeat(100);
    expect(safeStem(exportStem(long, date))).not.toBe(safeStem(exportStem(long, date)));
    expect(safeStem('한글<>:/\\?*\u0000.mp4.mp4')).toBe('한글________');
    expect(safeStem('CON')).toBe('_CON');
  });
  it('preserves grapheme clusters and six independent preset snapshots', () => {
    expect(graphemes('👩‍💻한가')).toEqual(['👩‍💻', '한', '가']);
    expect(textPresets).toHaveLength(6);
    const style = styleSnapshot({ ...textPresets[0].style, text: '내용' });
    expect(style).not.toHaveProperty('text');
    style.shadowStyle!.blur = 99;
    expect(textPresets[0].style.shadowStyle!.blur).not.toBe(99);
  });
});
