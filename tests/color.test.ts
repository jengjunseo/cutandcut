import { describe, it, expect } from 'vitest';
import { sourceColorWarning, validSourceColorSpace } from '../src/color';
import { emptyProject, validateProject, addAsset, type Asset } from '../src/model';

describe('source color diagnostics preserve metadata without claiming HDR parity', () => {
  it('starts with neutral black and preserves a saved custom background', () => {
    const project = emptyProject();
    expect(project.background).toBe('#000000');
    project.background = '#111820';
    expect(validateProject(JSON.parse(JSON.stringify(project))).background).toBe('#111820');
  });
  it('distinguishes SDR, HDR transfer and wide gamut', () => {
    expect(sourceColorWarning()).toBeUndefined();
    expect(
      sourceColorWarning({
        primaries: 'bt709',
        transfer: 'iec61966-2-1',
        matrix: 'bt709',
        fullRange: false,
      }),
    ).toBeUndefined();
    expect(sourceColorWarning({ transfer: 'pq' })).toContain('HDR');
    expect(sourceColorWarning({ transfer: 'hlg' })).toContain('HDR');
    expect(sourceColorWarning({ primaries: 'bt2020', transfer: 'bt709' })).toContain('넓은 색역');
  });
  it('round-trips new color data and keeps old projects readable', () => {
    const asset: Asset = {
      id: 'color',
      name: 'color.mp4',
      kind: 'video',
      size: 1,
      lastModified: 0,
      duration: 1_000_000,
      width: 640,
      height: 360,
      container: 'MP4',
      hasAudio: false,
      videoStart: 0,
      audioStart: 0,
      stored: false,
    };
    const project = addAsset(emptyProject(), asset, 0);
    expect(validateProject(JSON.parse(JSON.stringify(project)))).toEqual(project);
    project.assets[0].colorSpace = {
      primaries: 'bt2020',
      transfer: 'hlg',
      matrix: 'bt2020-ncl',
      fullRange: false,
    };
    expect(validateProject(JSON.parse(JSON.stringify(project)))).toEqual(project);
    expect(project.assets[0].colorSpace.matrix).toBe('bt2020-ncl');
  });
  it('rejects malformed color data before save/restore', () => {
    for (const value of [
      null,
      [],
      'srgb',
      { transfer: 5 },
      { matrix: {} },
      { fullRange: 'false' },
      { primaries: 'x'.repeat(65) },
    ])
      expect(validSourceColorSpace(value)).toBe(false);
    expect(
      validSourceColorSpace({ primaries: null, transfer: 'future-standard', fullRange: null }),
    ).toBe(true);
  });
});
