import { describe, it, expect, vi } from 'vitest';
import {
  emptyProject,
  clipDefaults,
  id,
  PROJECT_MAX_TIME,
  projectLimitError,
  validateProject,
} from '../src/model';
import { exportBudget } from '../src/export-policy';
import { saveOriginal } from '../src/storage';
import { History } from '../src/history';
import { parseCaptions } from '../src/captions';
describe('consistent editing, persistence and export limits', () => {
  it('checks actual quota for originals over 2GiB instead of silently refusing them', async () => {
    vi.stubGlobal('navigator', {
      storage: { estimate: async () => ({ quota: 2 * 1024 ** 3, usage: 0 }) },
    });
    try {
      await expect(saveOriginal('large', { size: 3 * 1024 ** 3 } as File)).rejects.toThrow(
        '저장 공간',
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('rejects low quota before attempting the original transaction', async () => {
    vi.stubGlobal('navigator', {
      storage: { estimate: async () => ({ quota: 1000, usage: 950 }) },
    });
    try {
      await expect(saveOriginal('small', { size: 100 } as File)).rejects.toThrow('저장 공간');
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('accepts multi-day projects and only rejects imprecise integer times', () => {
    const p = emptyProject();
    p.clips = [
      {
        ...clipDefaults(),
        id: id(),
        trackId: p.tracks[0].id,
        kind: 'text',
        name: '긴 자막',
        start: 0,
        duration: 48 * 3600 * 1e6,
        sourceIn: 0,
        text: {
          text: '끝',
          size: 32,
          color: '#fff',
          bold: false,
          align: 'center',
          outline: 0,
          shadow: false,
          background: 'transparent',
        },
      },
    ];
    expect(projectLimitError(p)).toBeUndefined();
    expect(validateProject(p).clips[0].duration).toBe(48 * 3600 * 1e6);
    p.clips = Array.from({ length: 10001 }, (_, i) => ({ ...p.clips[0], id: `clip-${i}` }));
    expect(validateProject(p).clips).toHaveLength(10001);
    p.clips[0].start = PROJECT_MAX_TIME;
    expect(projectLimitError(p)).toContain('정수');
    expect(() => validateProject(p)).toThrow();
  });
  it('estimates frame-rounded output without a fixed size or duration ceiling', () => {
    for (const bitrate of [3e6, 8e6, 16e6]) {
      const b = exportBudget('mp4', 48 * 3600, 30, bitrate);
      expect(b.allowed).toBe(true);
      expect(b.estimate).toBeGreaterThan(1024 ** 3);
    }
    expect(exportBudget('mp4', 300, 30, 16e6).allowed).toBe(true);
    expect(exportBudget('wav', 1800, 30, 30e6).allowed).toBe(true);
    expect(exportBudget('wav', 94 * 60, 30, 1e6).allowed).toBe(true);
    expect(exportBudget('mp4', 1100, 30, 8e6).estimate).toBeGreaterThan(1024 ** 3);
    for (const length of [NaN, Infinity, -1, 0, Number.MAX_VALUE])
      expect(exportBudget('mp4', length, 30, 8e6).allowed).toBe(false);
  });
  it('history keeps semantic no-ops and resets without crossing projects', () => {
    const h = new History(),
      p = emptyProject();
    expect(h.commit(p, structuredClone(p))).toBe(p);
    expect(h.commit(p, { ...p, workRange: undefined })).toBe(p);
    const renamed = h.commit(p, { ...p, name: '변경' });
    expect(h.undo(renamed)).toBe(p);
    h.redo(p);
    h.clear();
    const other = emptyProject();
    expect(h.undo(other)).toBe(other);
    expect(h.redo(other)).toBe(other);
  });
  it('parses subtitles beyond the former byte, cue-count and hour limits', () => {
    const cues = parseCaptions(
      Array.from(
        { length: 10001 },
        (_, i) =>
          `${i + 1}\n02:00:00,000 --> 02:00:01,000\n${i === 0 ? '가'.repeat(800000) : '자막'}`,
      ).join('\n\n'),
    );
    expect(cues).toHaveLength(10001);
    expect(cues[0].start).toBe(7200e6);
    expect(cues[0].text).toHaveLength(800000);
  });
});
