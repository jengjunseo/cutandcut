import type { Project, Asset } from './model';
export function safeStem(value: string) {
  const clean = value
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_')
    .replace(/(?:\.(?:mp4|webm|wav|mp3))+$/gi, '')
    .replace(/[. ]+$/, '')
    .trim();
  const short = Array.from(clean).slice(0, 110).join('') || 'CyanCut';
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(short) ? `_${short}` : short;
}
export function autoNamed(p: Project, asset: Asset): Project {
  if (
    p.nameOrigin === 'manual' ||
    p.clips.some((c) => c.kind !== 'text') ||
    (!p.nameOrigin && p.name !== '이름 없는 프로젝트')
  )
    return p;
  return { ...p, name: safeStem(asset.name.replace(/\.[^.]+$/, '')), nameOrigin: 'auto' };
}
let sequence = 0;
export function exportStem(project: string, date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${Array.from(safeStem(project)).slice(0, 80).join('')}_${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}_${String(++sequence).padStart(2, '0')}`;
}
