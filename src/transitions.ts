import {
  frameTick,
  seconds,
  linked,
  editable,
  type Project,
  type Clip,
  type Transition,
} from './model';
export type Direction = 'left' | 'right' | 'up' | 'down';
export function transitionWindow(c: Clip, fps: number) {
  const frames = c.transition?.frames ?? Math.round(seconds(c.transition?.duration ?? 0) * fps);
  return {
    start: c.start - frameTick(Math.floor(frames / 2), fps),
    end: c.start + frameTick(Math.ceil(frames / 2), fps),
    frames,
  };
}
export function limitTransitionFrames(p: Project, right: Clip, left: Clip, frames: number) {
  const tr = right.transition!;
  let before = left.duration,
    after = right.duration;
  const overlap = tr.kind !== 'black' && tr.kind !== 'white';
  if (overlap) {
    if (right.kind === 'video') before = Math.min(before, right.sourceIn / (right.speed ?? 1));
    if (left.kind === 'video')
      after = Math.min(
        after,
        ((p.assets.find((a) => a.id === left.assetId)?.duration ?? 0) -
          left.sourceIn -
          left.duration * (left.speed ?? 1)) /
          (left.speed ?? 1),
      );
  }
  if (left.transition)
    before = Math.min(
      before,
      right.start -
        (left.transition.version === 2
          ? transitionWindow(left, p.fps).end
          : left.start + (left.transition.kind === 'dissolve' ? 0 : left.transition.duration)),
    );
  const next = p.clips.find(
    (c) => c.trackId === right.trackId && c.start === right.start + right.duration && c.transition,
  );
  if (next)
    after = Math.min(
      after,
      (next.transition!.version === 2
        ? transitionWindow(next, p.fps).start
        : next.start - next.transition!.duration) - right.start,
    );
  // floor/ceil halves are bounded separately, including odd-frame transitions.
  const pre = Math.max(0, Math.floor(((before + 0.5) * p.fps) / 1e6)),
    post = Math.max(0, Math.floor(((after + 0.5) * p.fps) / 1e6));
  return Math.max(0, Math.min(frames, pre * 2 + 1, post * 2));
}
export function setTransitionV2(
  p: Project,
  clipId: string,
  kind: Transition['kind'],
  requested: number,
  direction: Direction = 'left',
  audio = false,
) {
  const right = p.clips.find((c) => c.id === clipId),
    left =
      right &&
      p.clips.find(
        (c) =>
          c.trackId === right.trackId && c.id !== right.id && c.start + c.duration === right.start,
      );
  if (!right || !left || right.kind === 'audio' || !editable(p, linked(p, [right.id, left.id])))
    return { project: p, message: '같은 시각 트랙의 인접 클립과 연결 음성 잠금을 확인하세요.' };
  const next = structuredClone(p),
    r = next.clips.find((c) => c.id === right.id)!,
    l = next.clips.find((c) => c.id === left.id)!;
  const requestedFrames = Math.max(1, Math.round(seconds(requested) * p.fps));
  r.transition = {
    kind,
    version: 2,
    duration: requested,
    frames: requestedFrames,
    direction,
    audioPolicy: audio ? (kind === 'black' ? 'linked-dip' : 'linked-crossfade') : 'unchanged',
  };
  const frames = limitTransitionFrames(next, r, l, requestedFrames);
  if (frames < 2)
    return {
      project: p,
      message:
        '양쪽 원본 여유 프레임이 부족합니다. 앞 클립의 끝과 뒤 클립의 시작을 트리밍하거나 검정 경유를 선택하세요.',
    };
  r.transition.frames = frames;
  r.transition.duration = frameTick(frames, p.fps);
  return {
    project: next,
    message: `전체 전환 ${frames}프레임 · ${seconds(r.transition.duration).toFixed(3)}초${frames < requestedFrames ? ' · 원본 여유·주변 전환에 맞춰 제한됨' : ''}. 프로젝트 길이는 유지됩니다.`,
  };
}
export function transitionGeometry(kind: Transition['kind'], direction: Direction, p: number) {
  const x = direction === 'left' ? -1 : direction === 'right' ? 1 : 0,
    y = direction === 'up' ? -1 : direction === 'down' ? 1 : 0;
  if (kind === 'slide')
    return [
      { offsetX: x * p, offsetY: y * p },
      { offsetX: -x * (1 - p), offsetY: -y * (1 - p) },
    ];
  if (kind === 'wipe') {
    const incoming =
      direction === 'left'
        ? { x: 1 - p, y: 0, w: p, h: 1 }
        : direction === 'right'
          ? { x: 0, y: 0, w: p, h: 1 }
          : direction === 'up'
            ? { x: 0, y: 1 - p, w: 1, h: p }
            : { x: 0, y: 0, w: 1, h: p };
    const outgoing =
      direction === 'left'
        ? { x: 0, y: 0, w: 1 - p, h: 1 }
        : direction === 'right'
          ? { x: p, y: 0, w: 1 - p, h: 1 }
          : direction === 'up'
            ? { x: 0, y: 0, w: 1, h: 1 - p }
            : { x: 0, y: p, w: 1, h: 1 - p };
    return [{ mask: outgoing }, { mask: incoming }];
  }
  return [{}, {}];
}
export type AudioEnvelope = {
  start: number;
  end: number;
  curves: { start: number; end: number; incoming: boolean; dip: boolean; cut: number }[];
};
export function audioEnvelope(p: Project, a: Clip): AudioEnvelope {
  const result: AudioEnvelope = { start: a.start, end: a.start + a.duration, curves: [] };
  if (!a.linkId) return result;
  const visual = p.clips.find((c) => c.kind === 'video' && c.linkId === a.linkId);
  if (!visual) return result;
  for (const right of p.clips) {
    if (
      right.transition?.version !== 2 ||
      right.transition.audioPolicy === 'unchanged' ||
      !right.transition.audioPolicy
    )
      continue;
    const left = p.clips.find(
      (c) =>
        c.trackId === right.trackId && c.start + c.duration === right.start && c.id !== right.id,
    );
    if (right.id !== visual.id && left?.id !== visual.id) continue;
    const window = transitionWindow(right, p.fps),
      incoming = right.id === visual.id,
      dip = right.transition.audioPolicy === 'linked-dip';
    result.curves.push({ ...window, incoming, dip, cut: right.start });
    if (!dip) {
      if (incoming) result.start = Math.min(result.start, window.start);
      else result.end = Math.max(result.end, window.end);
    }
  }
  return result;
}
export function envelopeGain(envelope: AudioEnvelope, t: number) {
  let gain = 1;
  for (const c of envelope.curves)
    if (t >= c.start && t < c.end) {
      const p = (t - c.start) / (c.end - c.start);
      gain *= c.dip
        ? c.incoming
          ? Math.max(0, (t - c.cut) / (c.end - c.cut))
          : Math.max(0, (c.cut - t) / (c.cut - c.start))
        : c.incoming
          ? Math.sin((p * Math.PI) / 2)
          : Math.cos((p * Math.PI) / 2);
    }
  return gain;
}
