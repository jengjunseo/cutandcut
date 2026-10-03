import { canEncodeAudio, canEncodeVideo } from 'mediabunny';
import type { ExportFormat } from './export-policy';
export type EncoderSettings = { width: number; height: number; fps: number };
export type Capabilities = {
  mp4: boolean;
  webm: boolean;
  wav: boolean;
  mp3: boolean;
  vp9: boolean;
  avc?: boolean;
  aacFallback?: boolean;
  errors?: Partial<Record<ExportFormat, string>>;
};
export async function capabilities(
  p: EncoderSettings,
  bitrate: number,
  only?: ExportFormat,
): Promise<Capabilities> {
  const result: Capabilities = {
    mp4: false,
    webm: false,
    wav: true,
    mp3: false,
    vp9: false,
    errors: {},
  };
  const video = { width: p.width, height: p.height, frameRate: p.fps, bitrate };
  const audio = { numberOfChannels: 2, sampleRate: 48000, bitrate: 192000 };
  await Promise.all(
    (only ? [only] : (['mp4', 'webm', 'mp3'] as const)).map(async (format) => {
      try {
        if (format === 'mp4') {
          result.avc = await canEncodeVideo('avc', video);
          if (!result.avc) return;
          const native = await canEncodeAudio('aac', audio);
          let aac = native;
          if (!native) {
            const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
            registerAacEncoder();
            aac = await canEncodeAudio('aac', audio);
          }
          result.mp4 = aac;
          result.aacFallback = !native && aac;
        } else if (format === 'webm') {
          const [vp9, opus] = await Promise.all([
            canEncodeVideo('vp9', video),
            canEncodeAudio('opus', audio),
          ]);
          result.vp9 = vp9;
          result.webm = opus && (vp9 || (await canEncodeVideo('vp8', video)));
        } else if (format === 'mp3') {
          const { registerMp3Encoder } = await import('@mediabunny/mp3-encoder');
          registerMp3Encoder();
          result.mp3 = await canEncodeAudio('mp3', audio);
        }
      } catch (e) {
        result.errors![format] = e instanceof Error ? e.message : String(e);
      }
    }),
  );
  return result;
}
