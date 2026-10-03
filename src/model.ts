export const SECOND = 1_000_000;
export const PROJECT_MAX_TIME = 3600 * SECOND;
export function projectLimitError(p: Project): string | undefined {
  if (p.clips.length > 10000 || p.assets.length > 1000)
    return '프로젝트는 클립 10,000개·원본 1,000개까지 지원합니다.';
  if (duration(p) > PROJECT_MAX_TIME || (p.workRange?.end ?? 0) > PROJECT_MAX_TIME)
    return '프로젝트 타임라인은 60분까지입니다. 원본 구간이나 배치 위치를 줄이세요. 출력 제한은 별도로 적용됩니다.';
}
export const tick = (seconds: number) => Math.round(seconds * SECOND);
export const seconds = (time: number) => time / SECOND;
export const frameTick = (frame: number, fps: number) => Math.round((frame * SECOND) / fps);
export const id = () => crypto.randomUUID();
export type Kind = 'video' | 'image' | 'audio' | 'text';
export type Transition = { kind: 'dissolve' | 'black' | 'white'; duration: number };
export type Asset = {
  id: string;
  name: string;
  kind: Exclude<Kind, 'text'>;
  size: number;
  lastModified: number;
  duration: number;
  width: number;
  height: number;
  container: string;
  videoCodec?: string;
  audioCodec?: string;
  videoStart: number;
  audioStart: number;
  origin?: number;
  hasAudio: boolean;
  thumbnail?: string;
  waveform?: number[];
  stored: boolean;
};
export type TextStyle = {
  text: string;
  size: number;
  color: string;
  bold: boolean;
  align: 'left' | 'center' | 'right';
  outline: number;
  shadow: boolean;
  background: string;
};
export type Clip = {
  id: string;
  trackId: string;
  assetId?: string;
  kind: Kind;
  name: string;
  start: number;
  duration: number;
  sourceIn: number;
  linkId?: string;
  groupId?: string;
  speed?: number;
  preservePitch?: boolean;
  flipX?: boolean;
  flipY?: boolean;
  crop?: { left: number; right: number; top: number; bottom: number };
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  fit: 'contain' | 'cover';
  volume: number;
  fadeIn: number;
  fadeOut: number;
  transition?: Transition;
  text?: TextStyle;
  textRole?: 'title' | 'caption';
};
export type Track = {
  id: string;
  name: string;
  kind: 'visual' | 'audio';
  locked: boolean;
  hidden: boolean;
  muted: boolean;
  solo?: boolean;
};
export type Project = {
  version: 1;
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  background: string;
  assets: Asset[];
  tracks: Track[];
  clips: Clip[];
  workRange?: { start: number; end: number };
  masterVolume?: number;
  safeArea?: boolean;
};
export function emptyProject(): Project {
  return {
    version: 1,
    id: id(),
    name: '이름 없는 프로젝트',
    width: 1280,
    height: 720,
    fps: 30,
    background: '#111820',
    assets: [],
    tracks: [
      {
        id: id(),
        name: '텍스트 · 이미지',
        kind: 'visual',
        locked: false,
        hidden: false,
        muted: false,
      },
      { id: id(), name: '영상 1', kind: 'visual', locked: false, hidden: false, muted: false },
      { id: id(), name: '원본 오디오', kind: 'audio', locked: false, hidden: false, muted: false },
      { id: id(), name: '음악', kind: 'audio', locked: false, hidden: false, muted: false },
    ],
    clips: [],
  };
}
export const duration = (p: Project) => Math.max(0, ...p.clips.map((c) => c.start + c.duration));
export const clipDefaults = (): Pick<
  Clip,
  'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'fit' | 'volume' | 'fadeIn' | 'fadeOut'
> => ({
  x: 0.5,
  y: 0.5,
  scale: 1,
  rotation: 0,
  opacity: 1,
  fit: 'contain',
  volume: 1,
  fadeIn: 0,
  fadeOut: 0,
});
export function linked(p: Project, ids: string[]): Clip[] {
  const chosen = new Set(ids);
  let changed = true;
  while (changed) {
    const members = p.clips.filter((c) => chosen.has(c.id));
    const links = new Set(members.map((c) => c.linkId).filter(Boolean)),
      groups = new Set(members.map((c) => c.groupId).filter(Boolean));
    changed = false;
    for (const c of p.clips)
      if (
        !chosen.has(c.id) &&
        ((c.linkId && links.has(c.linkId)) || (c.groupId && groups.has(c.groupId)))
      ) {
        chosen.add(c.id);
        changed = true;
      }
  }
  return p.clips.filter((c) => chosen.has(c.id));
}
export function editable(p: Project, clips: Clip[]) {
  return clips.length > 0 && !clips.some((c) => p.tracks.find((t) => t.id === c.trackId)?.locked);
}
export function addAsset(p: Project, asset: Asset, start?: number, trackId?: string): Project {
  const next = structuredClone(p);
  if (!next.assets.some((a) => a.id === asset.id)) next.assets.push(asset);
  const track =
    next.tracks.find((t) => t.id === trackId) ||
    (asset.kind === 'video'
      ? next.tracks.filter((t) => t.kind === 'visual' && !t.locked).at(-1)
      : asset.kind === 'audio'
        ? next.tracks.filter((t) => t.kind === 'audio' && !t.locked).at(-1)
        : next.tracks.find((t) => t.kind === 'visual' && !t.locked));
  if (!track || track.locked || track.kind !== (asset.kind === 'audio' ? 'audio' : 'visual'))
    return p;
  const at =
    start ??
    Math.max(
      0,
      ...next.clips.filter((c) => c.trackId === track.id).map((c) => c.start + c.duration),
    );
  const c: Clip = {
    id: id(),
    assetId: asset.id,
    trackId: track.id,
    kind: asset.kind,
    name: asset.name,
    start: Math.max(0, Math.round(at)),
    duration: asset.kind === 'image' ? tick(5) : asset.duration,
    sourceIn: 0,
    ...clipDefaults(),
  };
  if (asset.kind === 'video' && asset.hasAudio) {
    const audioTrack = next.tracks.find((t) => t.kind === 'audio' && !t.locked);
    if (!audioTrack) return p;
    c.linkId = id();
    next.clips.push({
      ...c,
      id: id(),
      trackId: audioTrack.id,
      kind: 'audio',
      name: asset.name + ' · 오디오',
    });
  }
  next.clips.push(c);
  return next;
}
export function split(p: Project, selected: string[], at: number): Project {
  const targets = linked(p, selected).filter((c) => at > c.start && at < c.start + c.duration);
  if (!editable(p, targets)) return p;
  const next = structuredClone(p);
  const rightLinks = new Map<string, string>();
  for (const target of targets) {
    const c = next.clips.find((c) => c.id === target.id)!;
    const left = at - c.start;
    const right = {
      ...structuredClone(c),
      id: id(),
      start: at,
      sourceIn: c.sourceIn + Math.round(left * (c.speed ?? 1)),
      duration: c.duration - left,
      transition: undefined,
      fadeIn: 0,
    };
    if (c.linkId) {
      if (!rightLinks.has(c.linkId)) rightLinks.set(c.linkId, id());
      right.linkId = rightLinks.get(c.linkId);
    }
    c.duration = left;
    c.fadeOut = 0;
    next.clips.push(right);
  }
  return normalize(next);
}
export function move(p: Project, selected: string[], delta: number, targetTrack?: string): Project {
  const targets = linked(p, selected);
  if (!editable(p, targets)) return p;
  const shift = Math.max(-Math.min(...targets.map((c) => c.start)), Math.round(delta));
  const next = structuredClone(p);
  const destination = targetTrack && p.tracks.find((t) => t.id === targetTrack);
  if (
    destination &&
    (destination.locked ||
      targets
        .filter((c) => selected.includes(c.id))
        .some((c) => (c.kind === 'audio' ? 'audio' : 'visual') !== destination.kind))
  )
    return p;
  for (const c of next.clips)
    if (targets.some((t) => t.id === c.id)) {
      c.start += shift;
      if (destination && selected.includes(c.id)) c.trackId = destination.id;
    }
  return normalize(next);
}
export function trim(
  p: Project,
  selected: string[],
  edge: 'start' | 'end',
  delta: number,
): Project {
  const targets = linked(p, selected);
  if (!editable(p, targets)) return p;
  let lower = -Infinity,
    upper = Infinity;
  const min = frameTick(1, p.fps);
  for (const c of targets) {
    const a = p.assets.find((a) => a.id === c.assetId);
    const finite = c.kind === 'video' || c.kind === 'audio';
    if (edge === 'start') {
      lower = Math.max(lower, -c.start, finite ? -c.sourceIn / (c.speed ?? 1) : -Infinity);
      upper = Math.min(upper, c.duration - min);
    } else {
      lower = Math.max(lower, min - c.duration);
      upper = Math.min(
        upper,
        finite && a ? (a.duration - c.sourceIn) / (c.speed ?? 1) - c.duration : Infinity,
      );
    }
  }
  const d = Math.max(lower, Math.min(upper, Math.round(delta)));
  const next = structuredClone(p);
  for (const c of next.clips)
    if (targets.some((t) => t.id === c.id)) {
      if (edge === 'start') {
        c.start += d;
        c.duration -= d;
        c.sourceIn += Math.round(d * (c.speed ?? 1));
      } else c.duration += d;
    }
  return normalize(next);
}
/** Ripple closes selected time intervals across EVERY track. Reject if any locked track would change,
 * or an unselected clip straddles a removed interval. This preserves inter-track synchronization. */
export function remove(
  p: Project,
  selected: string[],
  ripple = false,
): { project: Project; error?: string } {
  const targets = linked(p, selected);
  if (!editable(p, targets))
    return { project: p, error: '잠긴 트랙 또는 링크된 클립을 먼저 잠금 해제하세요.' };
  const ids = new Set(targets.map((c) => c.id));
  let next = structuredClone(p);
  next.clips = next.clips.filter((c) => !ids.has(c.id));
  if (ripple) {
    const ranges = targets.map((c) => [c.start, c.start + c.duration]).sort((a, b) => a[0] - b[0]);
    const merged: number[][] = [];
    for (const range of ranges) {
      const last = merged.at(-1);
      if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
      else merged.push([...range]);
    }
    for (const c of next.clips) {
      let shift = 0;
      for (const [a, b] of merged) {
        if (c.start < b && c.start + c.duration > a)
          return {
            project: p,
            error: '리플 구간에 다른 클립이 겹칩니다. 함께 선택하거나 일반 삭제를 사용하세요.',
          };
        if (c.start >= b) shift += b - a;
      }
      if (shift && p.tracks.find((t) => t.id === c.trackId)?.locked)
        return {
          project: p,
          error: '뒤쪽의 잠긴 트랙 때문에 동기화를 유지하며 리플 삭제할 수 없습니다.',
        };
      c.start -= shift;
    }
  }
  return { project: normalize(next) };
}
export function paste(p: Project, copied: Clip[], at: number, activeTrack?: string): Project {
  if (!copied.length) return p;
  const next = structuredClone(p);
  const offset = at - Math.min(...copied.map((c) => c.start));
  const groups = new Map<string, string>();
  for (const c of copied) {
    const track =
      copied.every((x) => x.trackId === c.trackId) && activeTrack
        ? next.tracks.find((t) => t.id === activeTrack)
        : next.tracks.find((t) => t.id === c.trackId);
    if (!track || track.locked || track.kind !== (c.kind === 'audio' ? 'audio' : 'visual'))
      return p;
    if (c.linkId && !groups.has(c.linkId)) groups.set(c.linkId, id());
    if (c.groupId && !groups.has(c.groupId)) groups.set(c.groupId, id());
    next.clips.push({
      ...structuredClone(c),
      id: id(),
      start: c.start + offset,
      trackId: track.id,
      linkId: c.linkId ? groups.get(c.linkId) : undefined,
      groupId: c.groupId ? groups.get(c.groupId) : undefined,
    });
  }
  return normalize(next);
}
export function reorder(
  p: Project,
  clipId: string,
  direction: -1 | 1,
): { project: Project; error?: string } {
  const c = p.clips.find((c) => c.id === clipId);
  if (!c) return { project: p };
  const track = p.clips.filter((x) => x.trackId === c.trackId).sort((a, b) => a.start - b.start);
  const other = track[track.indexOf(c) + direction];
  if (!other) return { project: p, error: '교환할 인접 클립이 없습니다.' };
  const targets = linked(p, [c.id, other.id]);
  if (!editable(p, targets)) return { project: p, error: '링크된 트랙까지 잠금 해제하세요.' };
  const [left, right] = c.start < other.start ? [c, other] : [other, c];
  const gap = right.start - left.start - left.duration;
  if (gap < 0) return { project: p, error: '겹친 클립은 시작 시간을 조절한 뒤 순서를 교환하세요.' };
  const next = structuredClone(p);
  const leftIds = new Set(linked(p, [left.id]).map((c) => c.id)),
    rightIds = new Set(linked(p, [right.id]).map((c) => c.id));
  if ([...leftIds].some((key) => rightIds.has(key)) || targets.some((item) => item.groupId))
    return {
      project: p,
      error: '그룹을 해제한 뒤 인접 클립을 교환하세요. 그룹은 드래그로 이동할 수 있습니다.',
    };
  for (const item of next.clips) {
    if (leftIds.has(item.id)) item.start = left.start + right.duration + gap;
    else if (rightIds.has(item.id)) item.start = left.start;
  }
  return { project: normalize(next) };
}
export function normalize(p: Project): Project {
  if (p.workRange)
    p.workRange = {
      start: Math.min(p.workRange.start, duration(p)),
      end: Math.min(p.workRange.end, duration(p)),
    };
  for (const c of p.clips) {
    c.start = Math.max(0, Math.round(c.start));
    c.duration = Math.max(frameTick(1, p.fps), Math.round(c.duration));
    c.sourceIn = Math.max(0, Math.round(c.sourceIn));
    c.fadeIn = Math.min(c.fadeIn, c.duration);
    c.fadeOut = Math.min(c.fadeOut, c.duration);
    if (c.transition) c.transition.duration = Math.min(c.transition.duration, c.duration / 2);
  }
  for (const c of p.clips)
    if (c.transition) {
      const prev = p.clips.find(
        (x) => x.id !== c.id && x.trackId === c.trackId && x.start + x.duration === c.start,
      );
      if (!prev) {
        c.transition = undefined;
        continue;
      }
      c.transition.duration = Math.min(
        c.transition.duration,
        prev.duration / 2,
        c.transition.kind === 'dissolve' && c.kind === 'video'
          ? c.sourceIn / (c.speed ?? 1)
          : Infinity,
      );
      if (c.transition.duration < frameTick(1, p.fps)) c.transition = undefined;
    }
  return p;
}
export function setTransition(
  p: Project,
  clipId: string,
  kind: Transition['kind'],
  requested: number,
): { project: Project; message: string } {
  const c = p.clips.find((c) => c.id === clipId);
  if (!c || c.kind === 'audio' || !editable(p, [c]))
    return { project: p, message: '잠금 해제된 영상·이미지·텍스트 클립을 선택하세요.' };
  const prev = p.clips.find(
    (x) => x.trackId === c.trackId && x.id !== c.id && x.start + x.duration === c.start,
  );
  if (!prev) return { project: p, message: '같은 트랙에서 앞 클립과 빈틈 없이 연결해야 합니다.' };
  const max = Math.min(
    c.duration / 2,
    prev.duration / 2,
    kind === 'dissolve' && c.kind === 'video' ? c.sourceIn / (c.speed ?? 1) : Infinity,
  );
  const d = Math.round(Math.min(requested, max));
  if (d < frameTick(1, p.fps))
    return {
      project: p,
      message:
        '디졸브에 필요한 원본 여유 프레임이 없습니다. 다음 클립의 시작 부분을 먼저 트리밍하세요.',
    };
  const next = structuredClone(p);
  next.clips.find((x) => x.id === c.id)!.transition = { kind, duration: d };
  return {
    project: next,
    message:
      d < requested
        ? '원본 여유와 클립 길이에 맞춰 전환 길이를 제한했습니다. 전체 길이는 유지됩니다.'
        : '트랜지션 적용됨 · 전체 길이는 유지됩니다.',
  };
}
export type Layer = {
  clip: Clip;
  sourceTime: number;
  alpha: number;
  overlay?: string;
  overlayAlpha?: number;
};
export function layers(p: Project, time: number): Layer[] {
  const output: Layer[] = [];
  for (const track of [...p.tracks].reverse()) {
    if (
      track.kind === 'audio' ||
      track.hidden ||
      (p.tracks.some((t) => t.kind === 'visual' && t.solo) && !track.solo)
    )
      continue;
    const clips = p.clips
      .filter((c) => c.trackId === track.id && c.kind !== 'audio')
      .sort((a, b) => a.start - b.start);
    for (const c of clips) {
      if (time < c.start || time >= c.start + c.duration) continue;
      const layer: Layer = {
        clip: c,
        sourceTime: seconds(c.sourceIn + (time - c.start) * (c.speed ?? 1)),
        alpha: c.opacity,
      };
      const next = clips.find((x) => x.start === c.start + c.duration && x.transition);
      if (next?.transition && time >= next.start - next.transition.duration) {
        const tr = next.transition;
        const progress = (time - next.start + tr.duration) / tr.duration;
        if (tr.kind === 'dissolve') {
          output.push(layer);
          output.push({
            clip: next,
            sourceTime: seconds(next.sourceIn + (time - next.start) * (next.speed ?? 1)),
            alpha: next.opacity * progress,
          });
          continue;
        }
        layer.overlay = tr.kind === 'white' ? '#ffffff' : '#000000';
        layer.overlayAlpha = progress;
      }
      if (
        c.transition &&
        c.transition.kind !== 'dissolve' &&
        time < c.start + c.transition.duration
      ) {
        layer.overlay = c.transition.kind === 'white' ? '#ffffff' : '#000000';
        layer.overlayAlpha = 1 - (time - c.start) / c.transition.duration;
      }
      output.push(layer);
    }
  }
  return output;
}
export function audioGain(c: Clip, time: number) {
  const local = time - c.start;
  return (
    c.volume *
    Math.min(
      1,
      c.fadeIn ? Math.max(0, local / c.fadeIn) : 1,
      c.fadeOut ? Math.max(0, (c.duration - local) / c.fadeOut) : 1,
    )
  );
}
/** Sources that can actually contribute to a range, including dissolve pre-roll. */
export function requiredAssets(p: Project, start: number, end: number, visual = true) {
  const keys = new Set<string>();
  for (const c of p.clips) {
    if (!c.assetId) continue;
    const track = p.tracks.find((t) => t.id === c.trackId)!;
    if (c.kind === 'audio') {
      if (track.muted || (p.tracks.some((t) => t.kind === 'audio' && t.solo) && !track.solo))
        continue;
    } else {
      if (
        !visual ||
        track.hidden ||
        (p.tracks.some((t) => t.kind === 'visual' && t.solo) && !track.solo)
      )
        continue;
    }
    const pre = c.transition?.kind === 'dissolve' ? c.transition.duration : 0;
    if (c.start - pre < end && c.start + c.duration > start) keys.add(c.assetId);
  }
  return keys;
}
export function snapTime(
  p: Project,
  time: number,
  playhead: number,
  exclude: string[],
  tolerance: number,
) {
  const points = [
    0,
    playhead,
    ...p.clips
      .filter((c) => !exclude.includes(c.id))
      .flatMap((c) => [c.start, c.start + c.duration]),
  ];
  const nearest = points.reduce(
    (a, b) => (Math.abs(b - time) < Math.abs(a - time) ? b : a),
    points[0],
  );
  return Math.abs(nearest - time) <= tolerance ? nearest : Math.max(0, time);
}
export function timecode(time: number, fps = 30) {
  const frame = Math.floor(((time + 0.5) / SECOND) * fps);
  const f = frame % fps;
  const s = Math.floor(frame / fps);
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60, f]
    .map((v) => String(v).padStart(2, '0'))
    .join(':');
}
export function validateProject(value: unknown): Project {
  const p = value as Project;
  const fail = () => {
    throw new Error('CyanCut v1 프로젝트 파일이 아니거나 데이터가 손상되었습니다.');
  };
  if (
    !p ||
    p.version !== 1 ||
    typeof p.id !== 'string' ||
    typeof p.name !== 'string' ||
    !Array.isArray(p.tracks) ||
    !Array.isArray(p.clips) ||
    !Array.isArray(p.assets)
  )
    fail();
  if (
    !Number.isInteger(p.width) ||
    !Number.isInteger(p.height) ||
    p.width < 16 ||
    p.height < 16 ||
    p.width > 1920 ||
    p.height > 1920 ||
    ![24, 25, 30, 50, 60].includes(p.fps) ||
    typeof p.background !== 'string'
  )
    fail();
  const tracks = new Set<string>();
  const assets = new Set<string>();
  const clips = new Set<string>();
  for (const t of p.tracks) {
    if (
      !t ||
      typeof t.id !== 'string' ||
      tracks.has(t.id) ||
      !['audio', 'visual'].includes(t.kind) ||
      typeof t.name !== 'string'
    )
      fail();
    if (
      [t.locked, t.hidden, t.muted].some((v) => typeof v !== 'boolean') ||
      (t.solo !== undefined && typeof t.solo !== 'boolean')
    )
      fail();
    tracks.add(t.id);
  }
  for (const a of p.assets) {
    if (
      !a ||
      typeof a.id !== 'string' ||
      assets.has(a.id) ||
      typeof a.name !== 'string' ||
      !['video', 'image', 'audio'].includes(a.kind) ||
      !Number.isSafeInteger(a.duration) ||
      a.duration < 0 ||
      !Number.isFinite(a.size)
    )
      fail();
    assets.add(a.id);
  }
  for (const c of p.clips) {
    if (
      !c ||
      typeof c.id !== 'string' ||
      clips.has(c.id) ||
      !tracks.has(c.trackId) ||
      !['video', 'image', 'audio', 'text'].includes(c.kind) ||
      typeof c.name !== 'string'
    )
      fail();
    clips.add(c.id);
    if (c.textRole !== undefined && !['title', 'caption'].includes(c.textRole)) fail();
    if (c.groupId !== undefined && typeof c.groupId !== 'string') fail();
    if (c.speed !== undefined && (!Number.isFinite(c.speed) || c.speed < 0.5 || c.speed > 2))
      fail();
    if (
      c.crop &&
      (!['left', 'right', 'top', 'bottom'].every(
        (k) =>
          Number.isFinite(c.crop![k as keyof typeof c.crop]) &&
          c.crop![k as keyof typeof c.crop] >= 0,
      ) ||
        c.crop.left + c.crop.right > 0.95 ||
        c.crop.top + c.crop.bottom > 0.95)
    )
      fail();
    if ([c.flipX, c.flipY, c.preservePitch].some((v) => v !== undefined && typeof v !== 'boolean'))
      fail();
    for (const n of ['start', 'duration', 'sourceIn'] as const)
      if (!Number.isSafeInteger(c[n]) || c[n] < 0) fail();
    for (const n of [
      'x',
      'y',
      'scale',
      'rotation',
      'opacity',
      'volume',
      'fadeIn',
      'fadeOut',
    ] as const)
      if (!Number.isFinite(c[n])) fail();
    if (
      c.duration < 1 ||
      c.scale <= 0 ||
      c.opacity < 0 ||
      c.opacity > 1 ||
      c.volume < 0 ||
      c.volume > 4 ||
      c.fadeIn < 0 ||
      c.fadeOut < 0 ||
      !['cover', 'contain'].includes(c.fit)
    )
      fail();
    if (c.kind !== 'text' && !assets.has(c.assetId ?? '')) fail();
    const a = p.assets.find((a) => a.id === c.assetId);
    if (
      (c.kind === 'video' || c.kind === 'audio') &&
      a &&
      c.sourceIn + Math.round(c.duration * (c.speed ?? 1)) > a.duration + 1
    )
      fail();
    if (
      c.kind === 'text' &&
      (!c.text ||
        typeof c.text.text !== 'string' ||
        !Number.isFinite(c.text.size) ||
        c.text.size <= 0 ||
        !['left', 'center', 'right'].includes(c.text.align) ||
        typeof c.text.color !== 'string' ||
        typeof c.text.background !== 'string')
    )
      fail();
    if (
      c.transition &&
      (!['dissolve', 'black', 'white'].includes(c.transition.kind) ||
        !Number.isFinite(c.transition.duration) ||
        c.transition.duration <= 0 ||
        c.transition.duration > c.duration / 2)
    )
      fail();
  }
  for (const group of new Set(p.clips.map((c) => c.linkId).filter(Boolean))) {
    const members = p.clips.filter((c) => c.linkId === group);
    const base = members[0];
    if (
      members.length !== 2 ||
      !members.some((c) => c.kind === 'video') ||
      !members.some((c) => c.kind === 'audio') ||
      members.some(
        (c) =>
          c.start !== base.start ||
          c.duration !== base.duration ||
          c.sourceIn !== base.sourceIn ||
          c.assetId !== base.assetId ||
          (c.speed ?? 1) !== (base.speed ?? 1),
      )
    )
      fail();
  }
  if (
    p.workRange &&
    (!Number.isSafeInteger(p.workRange.start) ||
      !Number.isSafeInteger(p.workRange.end) ||
      p.workRange.start < 0 ||
      p.workRange.end < p.workRange.start ||
      p.workRange.end > PROJECT_MAX_TIME)
  )
    fail();
  if (
    p.masterVolume !== undefined &&
    (!Number.isFinite(p.masterVolume) || p.masterVolume < 0 || p.masterVolume > 4)
  )
    fail();
  if (p.safeArea !== undefined && typeof p.safeArea !== 'boolean') fail();
  const limitError = projectLimitError(p);
  if (limitError) throw new Error(limitError);
  return structuredClone(p);
}
