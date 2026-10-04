import { useRef, useState, useEffect, useMemo, memo } from 'react';
import {
  MousePointer2,
  Scissors,
  Magnet,
  Plus,
  Minus,
  Copy,
  ClipboardPaste,
  Files,
  Trash2,
  Layers,
  LockKeyhole,
  LockKeyholeOpen,
  Eye,
  EyeOff,
  Volume2,
  VolumeX,
  ChevronUp,
  ChevronDown,
  Link2,
  Type,
  Music,
  Film,
  Image,
  ZoomIn,
} from 'lucide-react';
import {
  duration,
  seconds,
  tick,
  timecode,
  snapTime,
  move,
  trim,
  linked,
  editable,
  type Project,
  type Clip,
  type Track,
  type Transition,
} from './model';
import { IconButton, NameInput, usePopup } from './ui';
import PrecisionTools from './PrecisionTools';
import { shortcutKey } from './shortcuts';
type Props = {
  project: Project;
  time: number;
  selected: string[];
  activeTrack: string;
  setActiveTrack: (id: string) => void;
  select: (ids: string[]) => void;
  seek: (t: number) => void;
  commit: (p: Project) => void;
  draft: (p: Project | undefined) => void;
  split: () => void;
  remove: (ripple?: boolean) => void;
  duplicate: () => void;
  copy: () => void;
  paste: (mode?: 'insert' | 'overwrite' | 'append' | 'replace') => void;
  canPaste: boolean;
  removeTrack: (id: string) => void;
  addTrack: (kind: 'audio' | 'visual') => void;
  dropAsset: (assetId: string, trackId: string, start: number) => void;
  applyTransition: (kind: Transition['kind'], clipId: string) => void;
  snap: boolean;
  setSnap: (s: boolean) => void;
  tool: 'select' | 'split';
  setTool: (s: 'select' | 'split') => void;
  zoom: number;
  setZoom: (v: number) => void;
  notify: (s: string) => void;
};
export default memo(function Timeline({
  project: p,
  time,
  selected,
  activeTrack,
  setActiveTrack,
  select,
  seek,
  commit,
  draft,
  split: splitAction,
  remove,
  duplicate,
  copy,
  paste,
  canPaste,
  removeTrack,
  addTrack,
  dropAsset,
  applyTransition,
  snap,
  setSnap,
  tool,
  setTool,
  zoom,
  setZoom,
  notify,
}: Props) {
  const scroll = useRef<HTMLDivElement>(null);
  const cancelGesture = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => cancelGesture.current?.(), [p.id]);
  const [scrollLeft, setScrollLeft] = useState(0),
    [viewport, setViewport] = useState(1200),
    [ghost, setGhost] = useState<{
      track: string;
      start: number;
      duration: number;
      name: string;
    } | null>(null),
    [snapPoint, setSnapPoint] = useState<number | null>(null),
    [trackMenu, setTrackMenu] = useState(false);
  const fittedProject = useRef('');
  const trackPopup = usePopup(trackMenu, setTrackMenu);
  const [pasteMenu, setPasteMenu] = useState(false);
  const pastePopup = usePopup(pasteMenu, setPasteMenu);
  const [box, setBox] = useState<{ x: number; y: number; width: number; height: number }>(),
    ignoreClick = useRef(false);
  function boxSelect(e: React.PointerEvent) {
    if (
      e.button !== 0 ||
      e.pointerType === 'touch' ||
      e.target !== e.currentTarget ||
      tool !== 'select'
    )
      return;
    cancelGesture.current?.();
    const node = scroll.current!,
      target = e.currentTarget as HTMLElement,
      rect = node.getBoundingClientRect();
    const originX = e.clientX - rect.left + node.scrollLeft,
      originY = e.clientY - rect.top + node.scrollTop;
    const initial = e.shiftKey || e.ctrlKey || e.metaKey ? selected : [];
    let x = e.clientX,
      y = e.clientY,
      moved = false,
      ids: string[] = initial,
      raf = 0;
    target.setPointerCapture(e.pointerId);
    function update(schedule = true) {
      const r = node.getBoundingClientRect();
      if (x > r.right - 32) node.scrollLeft += 12;
      else if (x < r.left + 232) node.scrollLeft -= 12;
      if (y > r.bottom - 24) node.scrollTop += 10;
      else if (y < r.top + 24) node.scrollTop -= 10;
      const cx = x - r.left + node.scrollLeft,
        cy = y - r.top + node.scrollTop;
      const area = {
        x: Math.min(cx, originX),
        y: Math.min(cy, originY),
        width: Math.abs(cx - originX),
        height: Math.abs(cy - originY),
      };
      if (Math.abs(cx - originX) + Math.abs(cy - originY) > 5) moved = true;
      if (moved) {
        setBox(area);
        const hits = p.clips.filter((c) => {
          const row = node.querySelector<HTMLElement>(`[data-track-id="${c.trackId}"]`);
          if (!row || p.tracks.find((t) => t.id === c.trackId)?.locked) return false;
          const bounds = row.getBoundingClientRect(),
            top = bounds.top - r.top + node.scrollTop;
          return (
            200 + seconds(c.start + c.duration) * zoom > area.x &&
            200 + seconds(c.start) * zoom < area.x + area.width &&
            top + bounds.height > area.y &&
            top < area.y + area.height
          );
        });
        ids = [...new Set([...initial, ...hits.map((c) => c.id)])];
      }
      if (schedule) raf = requestAnimationFrame(() => update());
    }
    const move = (event: PointerEvent) => {
      x = event.clientX;
      y = event.clientY;
    };
    const cleanup = () => {
      cancelAnimationFrame(raf);
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', cancel);
      target.removeEventListener('lostpointercapture', cancel);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', key);
      cancelGesture.current = undefined;
      if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId);
      setBox(undefined);
    };
    const end = (event: PointerEvent) => {
      x = event.clientX;
      y = event.clientY;
      update(false);
      cleanup();
      if (moved) {
        ignoreClick.current = true;
        select(ids);
      }
    };
    const cancel = () => {
      cleanup();
      ignoreClick.current = true;
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      }
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end, { once: true });
    target.addEventListener('pointercancel', cancel, { once: true });
    target.addEventListener('lostpointercapture', cancel, { once: true });
    window.addEventListener('blur', cancel);
    cancelGesture.current = cancel;
    window.addEventListener('keydown', key);
    raf = requestAnimationFrame(() => update());
  }
  useEffect(() => {
    const node = scroll.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setViewport(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!p.clips.length || fittedProject.current === p.id) return;
    fittedProject.current = p.id;
    setZoom(Math.max(8, Math.min(200, (viewport - 240) / Math.max(6, seconds(duration(p)) + 1))));
  }, [p.id, p.clips.length, viewport]);
  const canEdit = editable(p, linked(p, selected));
  const overlapping = useMemo(() => {
    const ids = new Set<string>();
    for (const track of p.tracks.filter((t) => t.kind === 'visual')) {
      const clips = p.clips.filter((c) => c.trackId === track.id).sort((a, b) => a.start - b.start);
      let end = -1;
      clips.forEach((c, i) => {
        if (end > c.start || (clips[i + 1] && clips[i + 1].start < c.start + c.duration))
          ids.add(c.id);
        end = Math.max(end, c.start + c.duration);
      });
    }
    return ids;
  }, [p.clips, p.tracks]);
  const canSplit =
    canEdit && linked(p, selected).some((c) => c.start < time && c.start + c.duration > time);
  const timelineLength = Math.max(6, seconds(duration(p)) + 2);
  const width = Math.max(viewport - 200, timelineLength * zoom);
  const step = zoom >= 100 ? 1 : zoom >= 40 ? 2 : zoom >= 16 ? 5 : 10;
  const ticks = Array.from({ length: Math.floor(width / zoom / step) + 1 }, (_, i) => i * step);
  const icon = (c: Clip) =>
    c.kind === 'text' ? (
      <Type size={12} />
    ) : c.kind === 'audio' ? (
      <Music size={12} />
    ) : c.kind === 'image' ? (
      <Image size={12} />
    ) : (
      <Film size={12} />
    );
  const at = (clientX: number) =>
    Math.max(
      0,
      tick(
        (clientX -
          scroll.current!.getBoundingClientRect().left +
          scroll.current!.scrollLeft -
          200) /
          zoom,
      ),
    );
  function dragClip(e: React.PointerEvent, c: Clip, edge?: 'start' | 'end') {
    if (e.button !== 0) return;
    cancelGesture.current?.();
    e.stopPropagation();
    setActiveTrack(c.trackId);
    if (p.tracks.find((t) => t.id === c.trackId)?.locked) {
      notify('잠긴 트랙은 편집할 수 없습니다.');
      return;
    }
    const ids = selected.includes(c.id)
      ? selected
      : e.shiftKey || e.ctrlKey || e.metaKey
        ? [...selected, c.id]
        : [c.id];
    if ((e.ctrlKey || e.metaKey) && selected.includes(c.id)) {
      select(selected.filter((x) => x !== c.id));
      return;
    }
    select(ids);
    if (tool === 'split' && !edge) {
      seek(at(e.clientX));
      return;
    }
    const targets = linked(p, ids);
    if (targets.some((x) => p.tracks.find((t) => t.id === x.trackId)?.locked)) {
      notify('링크된 오디오 트랙도 잠금 해제하세요.');
      return;
    }
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const base = p,
      startX = e.clientX,
      startScroll = scroll.current!.scrollLeft;
    let next = p,
      moved = false,
      clientX = e.clientX,
      clientY = e.clientY,
      altDown = e.altKey,
      animation = 0;
    const update = () => {
      const total = clientX - startX + scroll.current!.scrollLeft - startScroll;
      let delta = tick(total / zoom);
      const origin = edge === 'end' ? c.start + c.duration : c.start;
      let point = origin + delta;
      if (snap && !altDown) {
        const excluded = targets.map((c) => c.id),
          tolerance = tick(8 / zoom);
        const snapped = snapTime(base, point, time, excluded, tolerance);
        const snappedEnd = !edge
          ? snapTime(base, point + c.duration, time, excluded, tolerance)
          : point + c.duration;
        const startDistance = Math.abs(snapped - point),
          endDistance = Math.abs(snappedEnd - point - c.duration);
        if (endDistance > 0 && (startDistance === 0 || endDistance < startDistance)) {
          delta = snappedEnd - c.duration - origin;
          setSnapPoint(snappedEnd);
        } else if (snapped !== point) {
          delta = snapped - origin;
          setSnapPoint(snapped);
        } else setSnapPoint(null);
      }
      const row = document
        .elementFromPoint(Math.min(window.innerWidth - 2, Math.max(1, clientX)), clientY)
        ?.closest<HTMLElement>('[data-track-id]');
      const dest = row?.dataset.trackId;
      const chosen = base.clips.filter((c) => ids.includes(c.id));
      const canReassign =
        chosen.every((c) => c.trackId === chosen[0].trackId) && dest !== chosen[0].trackId;
      next = edge
        ? trim(base, ids, edge, delta)
        : move(base, ids, delta, canReassign ? dest : undefined);
      draft(next);
    };
    const loop = () => {
      const s = scroll.current!;
      const rect = s.getBoundingClientRect();
      if (clientX > rect.right - 45) s.scrollLeft += Math.min(22, (clientX - rect.right + 45) / 2);
      else if (clientX < rect.left + 210)
        s.scrollLeft -= Math.min(22, (rect.left + 210 - clientX) / 2);
      if (moved) update();
      animation = requestAnimationFrame(loop);
    };
    animation = requestAnimationFrame(loop);
    const onMove = (event: PointerEvent) => {
      clientX = event.clientX;
      clientY = event.clientY;
      altDown = event.altKey;
      if (Math.abs(clientX - startX) > 3) moved = true;
    };
    const cleanup = () => {
      cancelAnimationFrame(animation);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onEnd);
      target.removeEventListener('pointercancel', onCancel);
      target.removeEventListener('lostpointercapture', onCancel);
      window.removeEventListener('blur', onCancel);
      window.removeEventListener('keydown', escape);
      window.removeEventListener('keyup', modifiers);
      cancelGesture.current = undefined;
      if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId);
      draft(undefined);
      setSnapPoint(null);
    };
    const onEnd = (event: PointerEvent) => {
      clientX = event.clientX;
      clientY = event.clientY;
      if (moved) update();
      cleanup();
      if (moved) {
        ignoreClick.current = true;
        commit(next);
      }
    };
    const onCancel = () => cleanup();
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Alt') {
        event.preventDefault();
        altDown = true;
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cleanup();
      } else if (
        !event.isComposing &&
        !(event.target as HTMLElement)?.closest('input,textarea,select') &&
        (event.ctrlKey ||
          event.metaKey ||
          ['s', 'x', 'z', 'c', 'v', 'b', 'delete', 'backspace'].includes(shortcutKey(event)))
      )
        cleanup();
    };
    const modifiers = (event: KeyboardEvent) => {
      altDown = event.altKey;
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onEnd, { once: true });
    target.addEventListener('pointercancel', onCancel, { once: true });
    target.addEventListener('lostpointercapture', onCancel, { once: true });
    window.addEventListener('blur', onCancel);
    cancelGesture.current = onCancel;
    window.addEventListener('keydown', escape);
    window.addEventListener('keyup', modifiers);
  }
  function rulerDrag(e: React.PointerEvent) {
    if (e.button !== 0) return;
    cancelGesture.current?.();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const change = (event: PointerEvent) => seek(Math.min(duration(p), at(event.clientX)));
    change(e.nativeEvent);
    const end = () => {
      el.removeEventListener('pointermove', change);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      el.removeEventListener('lostpointercapture', end);
      window.removeEventListener('blur', end);
      cancelGesture.current = undefined;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };
    el.addEventListener('pointermove', change);
    el.addEventListener('pointerup', end, { once: true });
    el.addEventListener('pointercancel', end, { once: true });
    el.addEventListener('lostpointercapture', end, { once: true });
    window.addEventListener('blur', end);
    cancelGesture.current = end;
  }
  function patchTrack(trackId: string, value: Partial<Track>) {
    commit({ ...p, tracks: p.tracks.map((t) => (t.id === trackId ? { ...t, ...value } : t)) });
  }
  function reorderTrack(index: number, delta: number) {
    const tracks = [...p.tracks];
    const dest = index + delta;
    if (dest < 0 || dest >= tracks.length) return;
    [tracks[index], tracks[dest]] = [tracks[dest], tracks[index]];
    commit({ ...p, tracks });
  }
  function over(e: React.DragEvent, trackId: string) {
    if (
      !e.dataTransfer.types.includes('application/cyancut-asset') &&
      !e.dataTransfer.types.includes('application/cyancut-transition')
    )
      return;
    e.preventDefault();
    const assetId = e.dataTransfer.types
        .find((s) => s.startsWith('application/cyancut-asset-id-'))
        ?.slice('application/cyancut-asset-id-'.length),
      asset = p.assets.find((a) => a.id === assetId);
    const name =
      asset?.name ??
      (e.dataTransfer.types.includes('application/cyancut-transition') ? '트랜지션' : '미디어');
    let t = at(e.clientX);
    if (snap) t = snapTime(p, t, time, [], tick(8 / zoom));
    setGhost({ track: trackId, start: t, duration: asset?.duration ?? tick(5), name });
  }
  function blankClick(e: React.MouseEvent, trackId: string) {
    if (ignoreClick.current) {
      ignoreClick.current = false;
      return;
    }
    if (e.target !== e.currentTarget) return;
    setActiveTrack(trackId);
    if (!e.shiftKey) select([]);
    seek(Math.min(duration(p), at(e.clientX)));
  }
  return (
    <section className="timeline-panel" tabIndex={0} aria-label="편집 타임라인">
      <div className="timeline-toolbar">
        <div className="tool-group">
          <IconButton
            label="선택 도구"
            active={tool === 'select'}
            onClick={() => setTool('select')}
          >
            <MousePointer2 size={16} />
          </IconButton>
          <IconButton
            label="분할 도구 · 클릭한 위치에서 분할"
            active={tool === 'split'}
            onClick={() => setTool('split')}
          >
            <Scissors size={16} />
          </IconButton>
          <span className="toolbar-divider" />
          <button
            className="text-tool"
            disabled={!canSplit}
            title={
              !canEdit
                ? '선택한 클립과 링크된 트랙의 잠금을 해제하세요.'
                : '클립 내부로 재생헤드를 이동해 분할'
            }
            onClick={splitAction}
          >
            <Scissors size={14} /> 분할
          </button>
          <IconButton label="복사 (C / Ctrl/Cmd+C)" disabled={!selected.length} onClick={copy}>
            <Copy size={15} />
          </IconButton>
          <IconButton label="붙여넣기 (Ctrl/Cmd+V)" disabled={!canPaste} onClick={() => paste()}>
            <ClipboardPaste size={15} />
          </IconButton>
          <div className="track-menu-wrap" ref={pastePopup}>
            <button
              className="text-tool"
              disabled={!canPaste}
              aria-label="붙여넣기 방식"
              aria-expanded={pasteMenu}
              aria-controls="paste-menu"
              onClick={() => setPasteMenu(!pasteMenu)}
            >
              ▾
            </button>
            {pasteMenu ? (
              <div className="small-menu" id="paste-menu">
                {(
                  [
                    ['insert', '삽입 (V)'],
                    ['append', '끝에 추가 (A)'],
                    ['overwrite', '덮어쓰기 (B)'],
                    ['replace', '선택 교체 (R)'],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    disabled={mode === 'replace' && !canEdit}
                    onClick={() => {
                      setPasteMenu(false);
                      paste(mode);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <IconButton label="복제 (Ctrl/Cmd+Shift+D)" disabled={!canEdit} onClick={duplicate}>
            <Files size={15} />
          </IconButton>
          <IconButton
            label="삭제 · 빈 공간 유지 (Z / Delete)"
            disabled={!canEdit}
            onClick={() => remove()}
          >
            <Trash2 size={15} />
          </IconButton>
          <button
            className="text-tool ripple-tool"
            title="리플 삭제 (X) · 전체 트랙의 시간 구간 제거"
            disabled={!canEdit}
            onClick={() => remove(true)}
          >
            리플 삭제
          </button>
          <span className="toolbar-divider" />
          <IconButton label="스냅 (Ctrl/Cmd+P)" active={snap} onClick={() => setSnap(!snap)}>
            <Magnet size={16} />
          </IconButton>
        </div>
        <div className="timeline-right">
          <div className="track-menu-wrap" ref={trackPopup}>
            <button
              className="text-tool"
              aria-expanded={trackMenu}
              aria-controls="track-menu"
              onClick={() => setTrackMenu(!trackMenu)}
            >
              <Plus size={14} /> 트랙
            </button>
            {trackMenu ? (
              <div className="small-menu" id="track-menu">
                <button
                  onClick={() => {
                    addTrack('visual');
                    setTrackMenu(false);
                  }}
                >
                  <Layers size={14} /> 영상 · 이미지 · 텍스트
                </button>
                <button
                  onClick={() => {
                    addTrack('audio');
                    setTrackMenu(false);
                  }}
                >
                  <Music size={14} /> 오디오
                </button>
              </div>
            ) : null}
          </div>
          <span className="toolbar-divider" />
          <IconButton label="타임라인 축소 (-)" onClick={() => setZoom(Math.max(8, zoom / 1.3))}>
            <Minus size={15} />
          </IconButton>
          <input
            className="zoom-range"
            aria-label="타임라인 확대"
            type="range"
            min={8}
            max={200}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
          <IconButton label="타임라인 확대 (+)" onClick={() => setZoom(Math.min(200, zoom * 1.3))}>
            <Plus size={15} />
          </IconButton>
          <IconButton
            label="전체 타임라인 보기"
            onClick={() =>
              setZoom(Math.max(8, (viewport - 240) / Math.max(10, seconds(duration(p)) + 2)))
            }
          >
            <ZoomIn size={15} />
          </IconButton>
        </div>
      </div>
      <PrecisionTools
        p={p}
        time={time}
        selected={selected}
        activeTrack={activeTrack}
        commit={commit}
        seek={seek}
        notify={notify}
      />
      <div
        className="timeline-scroll"
        ref={scroll}
        onScroll={(e) => {
          setScrollLeft(e.currentTarget.scrollLeft);
          setViewport(e.currentTarget.clientWidth);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setGhost(null);
        }}
      >
        <div className="timeline-content" style={{ width: width + 200 }}>
          <div className="ruler-row">
            <div className="track-ruler-label">
              트랙 <span>위쪽 레이어 우선</span>
            </div>
            <div className="ruler" style={{ width }} onPointerDown={rulerDrag}>
              {p.workRange && p.workRange.end > p.workRange.start ? (
                <div
                  className="range-highlight"
                  title="I/O 선택 구간"
                  style={{
                    left: seconds(p.workRange.start) * zoom,
                    width: seconds(p.workRange.end - p.workRange.start) * zoom,
                  }}
                />
              ) : null}
              {ticks
                .filter(
                  (t) => t * zoom >= scrollLeft - 100 && t * zoom < scrollLeft + viewport + 100,
                )
                .map((t) => (
                  <div className="ruler-tick" key={t} style={{ left: t * zoom }}>
                    <span>
                      {Math.floor(t / 60)}:{String(t % 60).padStart(2, '0')}
                    </span>
                  </div>
                ))}
            </div>
          </div>
          {p.tracks.map((track, index) => (
            <div
              className={`track-row ${activeTrack === track.id ? 'track-active' : ''} ${track.locked ? 'track-locked' : ''}`}
              key={track.id}
              data-track-id={track.id}
            >
              <div className="track-header" onClick={() => setActiveTrack(track.id)}>
                <div className="track-title">
                  <span className={`track-symbol ${track.kind}`}>
                    {track.kind === 'audio' ? <Music size={13} /> : <Layers size={13} />}
                  </span>
                  <NameInput
                    label={track.name + ' 이름'}
                    name={track.name}
                    onCommit={(name) => patchTrack(track.id, { name: name || track.name })}
                  />
                  <span className="track-number">{index + 1}</span>
                  <IconButton
                    label={`${track.name} 단독 재생`}
                    active={track.solo ?? false}
                    onClick={() => patchTrack(track.id, { solo: !track.solo })}
                  >
                    S
                  </IconButton>
                </div>
                <div className="track-controls">
                  <IconButton
                    label={`${track.name} ${track.locked ? '잠금 해제' : '잠금'}`}
                    active={track.locked}
                    onClick={() => patchTrack(track.id, { locked: !track.locked })}
                  >
                    {track.locked ? <LockKeyhole size={12} /> : <LockKeyholeOpen size={12} />}
                  </IconButton>
                  {track.kind === 'audio' ? (
                    <IconButton
                      label={`${track.name} ${track.muted ? '음소거 해제' : '음소거'}`}
                      active={track.muted}
                      onClick={() => patchTrack(track.id, { muted: !track.muted })}
                    >
                      {track.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
                    </IconButton>
                  ) : (
                    <IconButton
                      label={`${track.name} ${track.hidden ? '표시' : '숨기기'}`}
                      active={track.hidden}
                      onClick={() => patchTrack(track.id, { hidden: !track.hidden })}
                    >
                      {track.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
                    </IconButton>
                  )}
                  <IconButton
                    label={`${track.name} 위로`}
                    disabled={index === 0}
                    onClick={() => reorderTrack(index, -1)}
                  >
                    <ChevronUp size={12} />
                  </IconButton>
                  <IconButton
                    label={`${track.name} 아래로`}
                    disabled={index === p.tracks.length - 1}
                    onClick={() => reorderTrack(index, 1)}
                  >
                    <ChevronDown size={12} />
                  </IconButton>
                  <IconButton
                    label={`${track.name} 트랙 삭제`}
                    onClick={() => removeTrack(track.id)}
                  >
                    <Trash2 size={12} />
                  </IconButton>
                </div>
              </div>
              <div
                className="track-lane"
                onPointerDown={boxSelect}
                style={{ width }}
                onClick={(e) => blankClick(e, track.id)}
                onDragOver={(e) => over(e, track.id)}
                onDrop={(e) => {
                  const asset = e.dataTransfer.getData('application/cyancut-asset');
                  if (asset) {
                    e.preventDefault();
                    e.stopPropagation();
                    let t = at(e.clientX);
                    if (snap) t = snapTime(p, t, time, [], tick(8 / zoom));
                    dropAsset(asset, track.id, t);
                  }
                  setGhost(null);
                }}
              >
                {p.clips
                  .filter(
                    (c) =>
                      c.trackId === track.id &&
                      seconds(c.start + c.duration) * zoom > scrollLeft - 200 &&
                      seconds(c.start) * zoom < scrollLeft + viewport + 200,
                  )
                  .map((c) => {
                    const asset = p.assets.find((a) => a.id === c.assetId);
                    return (
                      <div
                        key={c.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`${c.name} 클립 · 시작 ${seconds(c.start).toFixed(2)}초 · 길이 ${seconds(c.duration).toFixed(2)}초`}
                        aria-pressed={selected.includes(c.id)}
                        title={`${c.name}${c.groupId ? ' · 그룹에 포함' : ''}${track.locked ? ' · 트랙 잠김' : ''}`}
                        className={`timeline-clip ${c.kind} ${selected.includes(c.id) ? 'clip-selected' : ''} ${track.hidden || track.muted ? 'clip-muted' : ''}`}
                        style={{
                          left: seconds(c.start) * zoom,
                          width: Math.max(4, seconds(c.duration) * zoom),
                        }}
                        onPointerDown={(e) => dragClip(e, c)}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (ignoreClick.current) {
                            ignoreClick.current = false;
                            return;
                          }
                          if (tool === 'split') splitAction();
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            select([c.id]);
                            setActiveTrack(c.trackId);
                          }
                        }}
                        onDragOver={(e) => {
                          if (e.dataTransfer.types.includes('application/cyancut-transition')) {
                            e.preventDefault();
                            e.stopPropagation();
                          }
                        }}
                        onDrop={(e) => {
                          const transition = e.dataTransfer.getData(
                            'application/cyancut-transition',
                          );
                          if (transition) {
                            e.preventDefault();
                            e.stopPropagation();
                            if (
                              transition === 'dissolve' ||
                              transition === 'black' ||
                              transition === 'white'
                            ) {
                              select([c.id]);
                              applyTransition(transition, c.id);
                            }
                          }
                        }}
                      >
                        <div className="clip-title">
                          {icon(c)}
                          <span>{c.kind === 'text' ? c.text?.text : c.name}</span>
                          {c.linkId ? <Link2 size={11} /> : null}
                          {overlapping.has(c.id) ? (
                            <small
                              className="clip-overlap"
                              title="동일 트랙에서 중첩됨 · 늦게 시작한 클립이 위에 표시됩니다"
                            >
                              중첩
                            </small>
                          ) : null}
                        </div>
                        {c.kind === 'video' || c.kind === 'image' ? (
                          <div
                            className="clip-thumbnails"
                            style={
                              asset?.thumbnail
                                ? { backgroundImage: `url(${asset.thumbnail})` }
                                : undefined
                            }
                          />
                        ) : c.kind === 'audio' ? (
                          <svg
                            className="clip-waveform"
                            viewBox="0 0 120 30"
                            preserveAspectRatio="none"
                            aria-label={asset?.waveform ? '오디오 파형' : '오디오 파형 분석 중'}
                          >
                            {asset?.waveform?.map((v, i) => (
                              <line
                                key={i}
                                x1={i}
                                x2={i}
                                y1={15 - Math.max(1, v * 14)}
                                y2={15 + Math.max(1, v * 14)}
                                stroke="currentColor"
                                strokeWidth=".7"
                              />
                            ))}
                          </svg>
                        ) : (
                          <span className="clip-text-preview">{c.text?.text}</span>
                        )}
                        {c.transition ? (
                          <span
                            className="transition-marker"
                            title={`${c.transition.kind} ${seconds(c.transition.duration)}초`}
                            style={{ width: Math.min(32, seconds(c.transition.duration) * zoom) }}
                          />
                        ) : null}
                        {!track.locked ? (
                          <>
                            <span
                              className="trim-handle trim-start"
                              role="separator"
                              aria-label="클립 시작 트리밍 · 속성 패널에서도 조절 가능"
                              onPointerDown={(e) => dragClip(e, c, 'start')}
                            />
                            <span
                              className="trim-handle trim-end"
                              role="separator"
                              aria-label="클립 끝 트리밍 · 속성 패널에서도 조절 가능"
                              onPointerDown={(e) => dragClip(e, c, 'end')}
                            />
                          </>
                        ) : null}
                      </div>
                    );
                  })}
                {ghost?.track === track.id ? (
                  <div
                    className="drop-ghost"
                    style={{
                      left: seconds(ghost.start) * zoom,
                      width: seconds(ghost.duration) * zoom,
                    }}
                  >
                    {ghost.name} · 드롭 후 원본 길이 적용
                  </div>
                ) : null}
                {!p.clips.length && index === 1 ? (
                  <span className="empty-track-hint">
                    미디어를 이곳에 끌어놓거나 보관함에서 + 버튼을 누르세요
                  </span>
                ) : null}
              </div>
            </div>
          ))}
          <div
            className="playhead"
            style={{ left: 200 + seconds(time) * zoom, height: '100%' }}
            onPointerDown={rulerDrag}
          >
            <span className="playhead-head" />
            <div className="playhead-line" />
          </div>
          {snapPoint !== null ? (
            <div className="snap-guide" style={{ left: 200 + seconds(snapPoint) * zoom }} />
          ) : null}
          {box ? (
            <div
              className="selection-box"
              style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
            />
          ) : null}
        </div>
      </div>
      {selected.length ? (
        <p className="ripple-impact">
          리플 영향: 전체 {p.tracks.length}개 트랙 · 잠금 또는 겹침이 있으면 작업을 거절합니다.
        </p>
      ) : null}
      <div className="timeline-status">
        <span>
          <span className="status-dot" />{' '}
          {p.clips.filter((c) => c.kind !== 'audio' || !c.linkId).length}개 클립{' '}
          <span className="dot-separator" />{' '}
          {selected.length ? `${selected.length}개 선택됨` : '클립을 선택해 편집하세요'}
        </span>
        <span className="timecode">
          {timecode(duration(p), p.fps)} <span className="status-fps">· {p.fps} FPS</span>
        </span>
      </div>
    </section>
  );
});
