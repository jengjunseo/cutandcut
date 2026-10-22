import { afterEach, expect, it, vi } from 'vitest';
import { diagnostic, failureEvent, PipelineFailure, workerFailure } from '../src/failures';
import { ProgressWatch } from '../src/progress-watch';
import { emptyProject, type Project } from '../src/model';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('diagnostics exclude filenames, subtitle text, project name/IDs and injected fields', () => {
  const p = emptyProject();
  p.name = 'PRIVATE PROJECT';
  p.id = 'PRIVATE ID';
  Object.assign(p, {
    token: 'SECRET TOKEN',
    email: 'PRIVATE EMAIL',
    clips: [{ id: 'PRIVATE CLIP', name: 'PRIVATE CLIP NAME', text: { text: 'PRIVATE SUBTITLE' } }],
  });
  p.assets = Array.from({ length: 20 }, () => ({
    name: 'PRIVATE FILENAME',
    id: 'PRIVATE ASSET',
    container: 'PRIVATE CONTAINER',
    videoCodec: 'PRIVATE CODEC',
    width: 3840,
    height: 2160,
    duration: 1000000,
    colorSpace: { transfer: 'hlg' },
  })) as Project['assets'];
  const info = diagnostic('VIDEO_UNSUPPORTED', 'probe', p);
  const text = JSON.stringify(info);
  expect(text).not.toContain('PRIVATE');
  expect(text).not.toContain('SECRET');
  expect(info.sources).toHaveLength(8);
  expect(info.sources[0]).toMatchObject({ container: 'unknown', videoCodec: 'unknown', hdr: true });
  expect(info.canvas).toEqual({ width: 1920, height: 1080, fps: 30 });
});
it('known failures survive worker transport while unknown browser failures remain distinguishable', () => {
  const original = new PipelineFailure(
    'VIDEO_UNSUPPORTED',
    '코덱을 열 수 없습니다. 변환 후 재시도하세요.',
  );
  const payload = failureEvent(original, 'probe');
  const restored = workerFailure(payload);
  expect(restored.code).toBe(original.code);
  expect(restored.message).toBe(original.message);
  expect(restored.diagnostic?.stage).toBe('probe');
  expect(
    failureEvent(new DOMException('private filename', 'QuotaExceededError'), 'export').code,
  ).toBe('STORAGE_FULL');
  expect(
    JSON.stringify(failureEvent(new Error('private filename'), 'preview').diagnostic),
  ).not.toContain('private filename');
  expect(workerFailure({ error: 'unknown', code: 'INVALID' }).code).toBe('UNKNOWN');
});
it('repeated progress messages cannot keep a stalled job alive; real progress extends the deadline', () => {
  vi.useFakeTimers();
  const expired = vi.fn();
  const watch = new ProgressWatch(expired, 100);
  watch.advance('frame:1');
  vi.advanceTimersByTime(70);
  watch.advance('frame:2');
  vi.advanceTimersByTime(70);
  expect(expired).not.toHaveBeenCalled();
  watch.advance('frame:2');
  vi.advanceTimersByTime(31);
  expect(expired).toHaveBeenCalledOnce();
  watch.stop();
});
it('cancellation prevents both pending and late progress from resurrecting the watchdog', () => {
  vi.useFakeTimers();
  const expired = vi.fn();
  const watch = new ProgressWatch(expired, 100);
  watch.stop();
  watch.advance('late frame');
  vi.advanceTimersByTime(1000);
  expect(expired).not.toHaveBeenCalled();
});
