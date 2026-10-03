import { clipDefaults, id, tick, seconds, type Project, type Clip, type TextStyle } from './model';
import { freeLayer } from './editing';
export type Cue = { start: number; end: number; text: string };
function timestamp(value: string) {
  const parts = value.replace(',', '.').split(':');
  if (parts.length < 2 || parts.length > 3 || parts.some((v) => !/^\d+(\.\d+)?$/.test(v)))
    throw new Error('자막 시간 형식이 올바르지 않습니다.');
  if (parts.slice(1).some((v) => Number(v) >= 60))
    throw new Error('자막 분·초 값이 올바르지 않습니다.');
  return tick(parts.map(Number).reduce((t, v) => t * 60 + v, 0));
}
export function parseCaptions(text: string): Cue[] {
  if (text.length > 2 * 1024 * 1024) throw new Error('자막은 2MB 이하로 가져오세요.');
  const cues: Cue[] = [];
  for (const block of text
    .replace(/^\uFEFF/, '')
    .replace(/\r/g, '')
    .split(/\n\s*\n/)) {
    const lines = block.trim().split('\n');
    if (/^(WEBVTT|NOTE|STYLE|REGION)(\s|$)/.test(lines[0])) continue;
    const index = lines.findIndex((line) => line.includes('-->'));
    if (index < 0) continue;
    const match = /^\s*(\S+)\s+-->\s+(\S+)/.exec(lines[index]);
    if (!match) throw new Error('자막 시간 구분자를 확인하세요.');
    const start = timestamp(match[1]),
      end = timestamp(match[2]);
    if (start < 0 || end <= start || end > tick(3600))
      throw new Error('자막 구간은 0–60분 범위의 양수 길이여야 합니다.');
    const value = lines
      .slice(index + 1)
      .join('\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
    if (value) cues.push({ start, end, text: value });
    if (cues.length > 10000) throw new Error('자막은 10,000개 이하로 가져오세요.');
  }
  if (!cues.length) throw new Error('SRT/VTT에서 읽을 수 있는 자막이 없습니다.');
  return cues.sort((a, b) => a.start - b.start);
}
const stamp = (time: number, separator: string) => {
  const total = Math.round(seconds(time) * 1000),
    ms = total % 1000,
    s = Math.floor(total / 1000) % 60,
    m = Math.floor(total / 60000) % 60,
    h = Math.floor(total / 3600000);
  return (
    [h, m, s].map((v) => String(v).padStart(2, '0')).join(':') +
    separator +
    String(ms).padStart(3, '0')
  );
};
export function serializeCaptions(clips: Clip[], format: 'srt' | 'vtt') {
  const sep = format === 'srt' ? ',' : '.';
  return (
    (format === 'vtt' ? 'WEBVTT\n\n' : '') +
    clips
      .filter((c) => c.kind === 'text')
      .sort((a, b) => a.start - b.start)
      .map(
        (c, i) =>
          `${format === 'srt' ? i + 1 + '\n' : ''}${stamp(c.start, sep)} --> ${stamp(c.start + c.duration, sep)}\n${c.text!.text}`,
      )
      .join('\n\n') +
    '\n'
  );
}
export function captionStyle(p: Project): TextStyle {
  return {
    text: '',
    size: Math.round(p.width / 34),
    color: '#ffffff',
    bold: false,
    align: 'center',
    outline: 2,
    shadow: true,
    background: 'transparent',
  };
}
export function addCaptions(p: Project, cues: Cue[]) {
  let next = structuredClone(p);
  for (const cue of cues) {
    const layer = freeLayer(next, cue.start, cue.end - cue.start, '자막');
    next = layer.project;
    next.clips.push({
      id: id(),
      kind: 'text',
      textRole: 'caption',
      name: '자막',
      trackId: layer.track.id,
      start: cue.start,
      duration: cue.end - cue.start,
      sourceIn: 0,
      ...clipDefaults(),
      y: 0.82,
      text: { ...captionStyle(p), text: cue.text },
    });
  }
  return next;
}
