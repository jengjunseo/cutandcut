import { version } from '../package.json';
import type { Project } from './model';

const codes = [
  'UNKNOWN',
  'EMPTY_FILE',
  'VIDEO_UNSUPPORTED',
  'AUDIO_UNSUPPORTED',
  'MISSING_SOURCE',
  'RESOURCE_LIMIT',
  'OUTPUT_UNSUPPORTED',
  'STORAGE_FULL',
  'WORKER_MESSAGE',
  'STALL_TIMEOUT',
] as const;
export type FailureCode = (typeof codes)[number];
export type FailureStage =
  'probe' | 'waveform' | 'capabilities' | 'capture' | 'audio-analysis' | 'preview' | 'export';
export class PipelineFailure extends Error {
  diagnostic?: ReturnType<typeof diagnostic>;
  constructor(
    public code: FailureCode,
    message: string,
  ) {
    super(message);
    this.name = 'PipelineFailure';
  }
}
const known = (value: unknown, allowed: readonly string[]) =>
  typeof value === 'string' && allowed.includes(value.toLowerCase())
    ? value.toLowerCase()
    : 'unknown';
const number = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e12 ? value : null;

/** Explicit allowlist. Never copy the project, error text, filename, IDs or arbitrary metadata. */
export function diagnostic(code: FailureCode, stage: FailureStage, project?: Project) {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const browser =
    /Edg\/(\d+)/.exec(ua) ??
    /SamsungBrowser\/(\d+)/.exec(ua) ??
    /(?:Chrome|Chromium)\/(\d+)/.exec(ua) ??
    /Version\/(\d+).*Safari/.exec(ua) ??
    /Firefox\/(\d+)/.exec(ua);
  return {
    appVersion: version,
    code,
    stage,
    environment: {
      browser: /Edg\//.test(ua)
        ? 'Edge'
        : /SamsungBrowser\//.test(ua)
          ? 'Samsung Internet'
          : /Chrome|Chromium/.test(ua)
            ? 'Chromium'
            : /Firefox/.test(ua)
              ? 'Firefox'
              : /Safari/.test(ua)
                ? 'Safari'
                : 'unknown',
      major: browser ? Number(browser[1]) : null,
      os: /Android/.test(ua)
        ? 'Android'
        : /iPhone|iPad/.test(ua)
          ? 'iOS/iPadOS'
          : /Windows/.test(ua)
            ? 'Windows'
            : /Mac/.test(ua)
              ? 'macOS'
              : /Linux/.test(ua)
                ? 'Linux'
                : 'unknown',
    },
    canvas: project
      ? { width: number(project.width), height: number(project.height), fps: number(project.fps) }
      : null,
    sources: Array.isArray(project?.assets)
      ? project.assets
          .slice(0, 8)
          .filter((a) => a && typeof a === 'object')
          .map((a) => ({
            container: known(a.container, [
              'mp4',
              'mov',
              'webm',
              'mkv',
              'avi',
              'wav',
              'wave',
              'mp3',
              'm4a',
              'flac',
              'ogg',
              'image/png',
              'image/jpeg',
              'image/webp',
              'image/avif',
            ]),
            videoCodec: known(a.videoCodec, ['avc', 'hevc', 'vp8', 'vp9', 'av1']),
            audioCodec: known(a.audioCodec, [
              'aac',
              'mp3',
              'opus',
              'vorbis',
              'flac',
              'pcm-s16',
              'pcm-s24',
              'pcm-s32',
              'pcm-f32',
              'pcm-f64',
            ]),
            width: number(a.width),
            height: number(a.height),
            durationUs: number(a.duration),
            hdr: a.colorSpace?.transfer === 'pq' || a.colorSpace?.transfer === 'hlg',
          }))
      : [],
  };
}
export function failureEvent(error: unknown, stage: FailureStage, project?: Project) {
  const code: FailureCode =
    error instanceof PipelineFailure
      ? error.code
      : error instanceof Error && error.name === 'QuotaExceededError'
        ? 'STORAGE_FULL'
        : error instanceof Error && error.name === 'DataCloneError'
          ? 'WORKER_MESSAGE'
          : 'UNKNOWN';
  return {
    error: error instanceof Error ? error.message : String(error),
    code,
    diagnostic: diagnostic(code, stage, project),
  };
}
export function workerFailure(data: {
  error: string;
  code?: string;
  diagnostic?: ReturnType<typeof diagnostic>;
}) {
  const failure = new PipelineFailure(
    codes.includes(data.code as FailureCode) ? (data.code as FailureCode) : 'UNKNOWN',
    data.error,
  );
  failure.diagnostic = data.diagnostic;
  return failure;
}
