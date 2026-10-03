import { describe, it, expect } from 'vitest';
import {
  emptyProject,
  clipDefaults,
  id,
  PROJECT_MAX_TIME,
  projectLimitError,
  validateProject,
} from '../src/model';
import { exportBudget, EXPORT_MAX_BYTES } from '../src/export-policy';
import { History } from '../src/history';
describe('consistent editing, persistence and export limits', () => {
  it('accepts the same 60-minute boundary and explains overlong projects', () => {
    const p = emptyProject();
    p.clips = [
      {
        ...clipDefaults(),
        id: id(),
        trackId: p.tracks[0].id,
        kind: 'text',
        name: '긴 자막',
        start: 0,
        duration: PROJECT_MAX_TIME,
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
    expect(validateProject(p).clips[0].duration).toBe(PROJECT_MAX_TIME);
    p.clips[0].duration++;
    expect(projectLimitError(p)).toContain('60분');
    expect(() => validateProject(p)).toThrow('60분');
  });
  it('uses video frame rounding, AAC bitrate and the same memory budget', () => {
    for (const bitrate of [3e6, 8e6, 16e6]) {
      const b = exportBudget('mp4', 300, 30, bitrate);
      expect(exportBudget('mp4', b.maxSeconds, 30, bitrate).allowed).toBe(true);
      expect(exportBudget('mp4', b.maxSeconds + 1 / 30, 30, bitrate).allowed).toBe(false);
      expect(b.estimate).toBeGreaterThan((300 * bitrate) / 8);
    }
    expect(exportBudget('mp4', 300, 30, 8e6).maxSeconds).toBeCloseTo(262, 0);
    expect(exportBudget('wav', 300, 30, 30e6).allowed).toBe(true);
    expect(exportBudget('wav', 301, 30, 1e6).allowed).toBe(false);
    expect(exportBudget('mp4', 270, 30, 8e6).estimate).toBeGreaterThan(EXPORT_MAX_BYTES);
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
});
