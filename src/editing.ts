import {
  addAsset,
  id,
  tick,
  frameTick,
  duration,
  trim,
  linked,
  editable,
  normalize,
  paste,
  projectLimitError,
  type Clip,
  type Asset,
  type Project,
  type Track,
} from './model';

/** Clipboard inserts open time on every track; overwrites affect destination tracks and linked partners. */
export function pasteEdit(
  p: Project,
  copied: Clip[],
  at: number,
  activeTrack: string,
  mode: 'insert' | 'overwrite' | 'append' | 'replace' = 'insert',
  selection: string[] = [],
): { project: Project; error?: string; inserted?: string[] } {
  if (!copied.length) return { project: p, error: '먼저 타임라인 클립을 복사하세요.' };
  let base = p;
  if (mode === 'append') at = duration(p);
  if (mode === 'replace') {
    const chosen = linked(p, selection);
    if (!editable(p, chosen))
      return { project: p, error: '교체할 클립과 연결·그룹 구성원의 잠금을 확인하세요.' };
    at = Math.min(...chosen.map((c) => c.start));
    base = { ...p, clips: p.clips.filter((c) => !chosen.some((x) => x.id === c.id)) };
  }
  if (!Number.isSafeInteger(at) || at < 0)
    return { project: p, error: '올바른 재생헤드 위치를 지정하세요.' };
  const placed = paste(base, copied, at, activeTrack);
  if (placed === base) return { project: p, error: '붙여넣을 트랙 종류와 잠금을 확인하세요.' };
  const added = placed.clips.filter((c) => !base.clips.some((old) => old.id === c.id));
  const span = Math.max(...added.map((c) => c.start + c.duration)) - at;
  if (mode === 'insert' || mode === 'overwrite') {
    const destination = new Set(added.map((c) => c.trackId));
    const affected =
      mode === 'insert'
        ? base.clips.filter((c) => c.start + c.duration > at)
        : linked(
            base,
            base.clips
              .filter(
                (c) =>
                  destination.has(c.trackId) && c.start < at + span && c.start + c.duration > at,
              )
              .map((c) => c.id),
          );
    if (
      affected.length &&
      !editable(
        base,
        linked(
          base,
          affected.map((c) => c.id),
        ),
      )
    )
      return { project: p, error: '영향받는 트랙과 연결·그룹 구성원의 잠금을 먼저 해제하세요.' };
    const tracks = new Set(affected.map((c) => c.trackId));
    const end = mode === 'insert' ? at : at + span;
    const rightLinks = new Map<string, string>(),
      rightGroups = new Map<string, string>();
    const clips: Clip[] = [];
    for (const c of base.clips) {
      if (!tracks.has(c.trackId) || c.start + c.duration <= at) {
        clips.push(c);
        continue;
      }
      if (c.start >= end) {
        clips.push(mode === 'insert' ? { ...c, start: c.start + span } : c);
        continue;
      }
      const left = at - c.start,
        right = c.start + c.duration - end;
      if ((left > 0 && left < frameTick(1, p.fps)) || (right > 0 && right < frameTick(1, p.fps)))
        return { project: p, error: '클립 경계에서 한 프레임 이상 떨어진 위치를 사용하세요.' };
      if (left > 0) clips.push({ ...c, duration: left, fadeOut: 0 });
      if (right > 0) {
        if (c.linkId && !rightLinks.has(c.linkId)) rightLinks.set(c.linkId, id());
        if (c.groupId && !rightGroups.has(c.groupId)) rightGroups.set(c.groupId, id());
        clips.push({
          ...c,
          id: id(),
          start: mode === 'insert' ? at + span : end,
          duration: right,
          sourceIn: c.sourceIn + Math.round((end - c.start) * (c.speed ?? 1)),
          linkId: c.linkId ? rightLinks.get(c.linkId) : undefined,
          groupId: c.groupId ? rightGroups.get(c.groupId) : undefined,
          transition: undefined,
          fadeIn: 0,
        });
      }
    }
    base = { ...placed, clips: [...clips, ...added], workRange: undefined };
  } else base = placed;
  const next = normalize(structuredClone(base)),
    error = projectLimitError(next);
  return error ? { project: p, error } : { project: next, inserted: added.map((c) => c.id) };
}
/** Reuse a layer only when it has room; keep overlays separate from the base video. */
export function freeLayer(p: Project, start: number, length: number, name: string) {
  const base = p.tracks.filter((t) => t.kind === 'visual').at(-1)?.id;
  const track = p.tracks.find(
    (t) =>
      t.kind === 'visual' &&
      !t.locked &&
      !t.hidden &&
      t.id !== base &&
      !p.clips.some(
        (c) => c.trackId === t.id && c.start < start + length && c.start + c.duration > start,
      ),
  );
  if (track) return { project: p, track };
  const added: Track = {
    id: id(),
    name,
    kind: 'visual',
    locked: false,
    hidden: false,
    muted: false,
  };
  return { project: { ...p, tracks: [added, ...p.tracks] }, track: added };
}

export function parseTimecode(value: string, fps: number) {
  const frame = /^(\d{1,3}):(\d{2}):(\d{2}):(\d{2})$/.exec(value.trim());
  if (frame) {
    const [, h, m, s, f] = frame.map(Number);
    if (m >= 60 || s >= 60 || f >= fps)
      throw new Error('분·초는 0–59, 프레임은 FPS보다 작아야 합니다.');
    return frameTick(((h * 60 + m) * 60 + s) * fps + f, fps);
  }
  const parts = value.trim().split(':');
  if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p)))
    throw new Error('HH:MM:SS:FF 또는 초 숫자로 입력하세요.');
  const n = parts.map(Number);
  if (n.length > 1 && n.slice(1).some((v) => v >= 60))
    throw new Error('분·초는 60보다 작아야 합니다.');
  return frameTick(Math.round(n.reduce((s, v) => s * 60 + v, 0) * fps), fps);
}
export function clipBoundary(p: Project, time: number, direction: -1 | 1) {
  const values = [
    ...new Set([0, duration(p), ...p.clips.flatMap((c) => [c.start, c.start + c.duration])]),
  ].sort((a, b) => a - b);
  return direction < 0
    ? (values.filter((v) => v < time).at(-1) ?? 0)
    : (values.find((v) => v > time) ?? duration(p));
}
export function trimToHead(p: Project, selection: string[], time: number, edge: 'start' | 'end') {
  const c = p.clips.find((c) => selection.includes(c.id));
  if (!c || time <= c.start || time >= c.start + c.duration) return p;
  return trim(p, selection, edge, time - (edge === 'start' ? c.start : c.start + c.duration));
}
export function groupClips(p: Project, selection: string[], ungroup = false) {
  const members = linked(p, selection);
  if (!editable(p, members) || (!ungroup && members.length < 2)) return p;
  const key = ungroup ? undefined : id();
  return {
    ...p,
    clips: p.clips.map((c) => (members.some((m) => m.id === c.id) ? { ...c, groupId: key } : c)),
  };
}
export function deleteTrack(p: Project, trackId: string): { project: Project; error?: string } {
  const track = p.tracks.find((t) => t.id === trackId);
  if (!track) return { project: p };
  const members = linked(
    p,
    p.clips.filter((c) => c.trackId === trackId).map((c) => c.id),
  );
  if (track.locked || (members.length && !editable(p, members)))
    return { project: p, error: '트랙과 연결·그룹 구성원의 잠금을 먼저 해제하세요.' };
  const links = new Set(members.filter((c) => c.trackId === trackId).map((c) => c.linkId));
  return {
    project: {
      ...p,
      tracks: p.tracks.filter((t) => t.id !== trackId),
      clips: p.clips
        .filter((c) => c.trackId !== trackId)
        .map((c) => (c.linkId && links.has(c.linkId) ? { ...c, linkId: undefined } : c)),
    },
  };
}
export function changeSpeed(p: Project, selection: string[], speed: number, preservePitch = true) {
  const linkedMembers = linked(p, selection);
  if (!editable(p, linkedMembers) || !Number.isFinite(speed) || speed < 0.5 || speed > 2) return p;
  const members = linkedMembers.filter((c) => c.kind === 'video' || c.kind === 'audio');
  if (!members.length) return p;
  const ids = new Set(members.map((c) => c.id));
  if (members.some((c) => Math.round((c.duration * (c.speed ?? 1)) / speed) < frameTick(1, p.fps)))
    return p;
  const next = structuredClone(p);
  for (const c of next.clips)
    if (ids.has(c.id)) {
      c.duration = Math.round((c.duration * (c.speed ?? 1)) / speed);
      c.speed = speed;
      c.preservePitch = preservePitch;
    }
  return normalize(next);
}
export function markRange(p: Project, time: number, edge: 'start' | 'end') {
  let start = p.workRange?.start ?? 0,
    end = Math.min(p.workRange?.end ?? duration(p), duration(p));
  if (edge === 'start') {
    start = time;
    end = Math.max(end, start);
  } else {
    end = time;
    start = Math.min(start, end);
  }
  return { ...p, workRange: { start, end } };
}
/** Remove a gap on the active track across every track, splitting crossing clips rather than desynchronizing them. */
export function gapRange(p: Project, time: number, trackId: string) {
  const clips = p.clips.filter((c) => c.trackId === trackId);
  if (!clips.length || clips.some((c) => c.start <= time && c.start + c.duration > time))
    return { project: p, error: '활성 트랙의 빈 구간에 재생헤드를 놓으세요.' };
  const start = Math.max(
    0,
    ...clips.filter((c) => c.start + c.duration <= time).map((c) => c.start + c.duration),
  );
  const end = Math.min(...clips.filter((c) => c.start > time).map((c) => c.start));
  if (!Number.isFinite(end) || end <= start)
    return { project: p, error: '뒤에 클립이 있는 빈 구간만 제거할 수 있습니다.' };
  if (
    p.clips.some(
      (c) => c.start + c.duration > start && p.tracks.find((t) => t.id === c.trackId)?.locked,
    )
  )
    return {
      project: p,
      error: '전체 트랙에 영향을 줍니다. 영향을 받는 잠긴 트랙을 먼저 해제하세요.',
    };
  return { project: p, start, end };
}
export function deleteGap(
  p: Project,
  time: number,
  trackId: string,
): { project: Project; error?: string } {
  const range = gapRange(p, time, trackId);
  if (range.error) return range;
  const { start, end } = range as { start: number; end: number };
  const rightLinks = new Map<string, string>(),
    result: Project = { ...structuredClone(p), clips: [] };
  for (const c of structuredClone(p.clips)) {
    if (c.start + c.duration <= start) result.clips.push({ ...c });
    else if (c.start >= end) result.clips.push({ ...c, start: c.start - (end - start) });
    else {
      if (c.start < start) result.clips.push({ ...c, duration: start - c.start, fadeOut: 0 });
      if (c.start + c.duration > end) {
        if (c.linkId && !rightLinks.has(c.linkId)) rightLinks.set(c.linkId, id());
        result.clips.push({
          ...c,
          id: id(),
          start: start,
          sourceIn: c.sourceIn + Math.round((end - c.start) * (c.speed ?? 1)),
          duration: c.start + c.duration - end,
          linkId: c.linkId ? rightLinks.get(c.linkId) : undefined,
          transition: undefined,
          fadeIn: 0,
        });
      }
    }
  }
  result.workRange = undefined;
  return { project: normalize(result) };
}
export function insertMedia(p: Project, asset: Asset, at: number, target?: string): Project {
  let next = p;
  let track = target && p.tracks.find((t) => t.id === target);
  if (!target && asset.kind === 'image') {
    const layer = freeLayer(p, at, tick(5), '이미지');
    next = layer.project;
    track = layer.track;
  } else if (!target)
    track = p.tracks
      .filter(
        (t) => !t.locked && !t.hidden && t.kind === (asset.kind === 'audio' ? 'audio' : 'visual'),
      )
      .at(-1);
  if (!track) {
    if (target) return p;
    track = {
      id: id(),
      name: asset.kind === 'audio' ? '음악' : '영상',
      kind: asset.kind === 'audio' ? 'audio' : 'visual',
      locked: false,
      hidden: false,
      muted: false,
    };
    next = { ...p, tracks: [...p.tracks, track] };
  }
  if (
    asset.kind === 'video' &&
    asset.hasAudio &&
    !next.tracks.some((t) => t.kind === 'audio' && !t.locked)
  )
    next = {
      ...next,
      tracks: [
        ...next.tracks,
        {
          id: id(),
          name: '원본 오디오',
          kind: 'audio',
          locked: false,
          hidden: false,
          muted: false,
        },
      ],
    };
  return addAsset(next, asset, asset.kind === 'video' && !target ? undefined : at, track.id);
}
