import { useState, useEffect, useRef } from 'react';
import { type Project, linked, editable, seconds } from './model';
import { clipBoundary, trimToHead, markRange, deleteGap, gapRange, groupClips } from './editing';
export default function PrecisionTools({
  p,
  time,
  selected,
  activeTrack,
  commit,
  seek,
  notify,
}: {
  p: Project;
  time: number;
  selected: string[];
  activeTrack: string;
  commit: (p: Project) => void;
  seek: (t: number) => void;
  notify: (s: string) => void;
}) {
  const [pending, setPending] = useState<{
    base: Project;
    start: number;
    end: number;
    time: number;
    track: string;
  }>();
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pending) return;
    const old = document.activeElement as HTMLElement;
    dialog.current?.focus();
    return () => old?.focus();
  }, [pending]);
  const affected = pending ? p.clips.filter((c) => c.start + c.duration > pending.start) : [];
  const members = linked(p, selected),
    canEdit = editable(p, members),
    inside = members.some((c) => c.start < time && c.start + c.duration > time);
  return (
    <div className="precision-tools" aria-label="정밀 편집 도구">
      <button onClick={() => seek(clipBoundary(p, time, -1))} title="이전 클립 경계 (↑)">
        이전 경계
      </button>
      <button onClick={() => seek(clipBoundary(p, time, 1))} title="다음 클립 경계 (↓)">
        다음 경계
      </button>
      <button onClick={() => commit(markRange(p, time, 'start'))}>구간 시작 I</button>
      <button onClick={() => commit(markRange(p, time, 'end'))}>구간 끝 O</button>
      {p.workRange ? (
        <button onClick={() => commit({ ...p, workRange: undefined })}>구간 해제</button>
      ) : null}
      <button
        disabled={!canEdit || !inside}
        onClick={() => commit(trimToHead(p, selected, time, 'start'))}
        title="선택 클립에서 재생헤드 앞부분 트림 ([)"
      >
        앞 자르기
      </button>
      <button
        disabled={!canEdit || !inside}
        onClick={() => commit(trimToHead(p, selected, time, 'end'))}
        title="선택 클립에서 재생헤드 뒷부분 트림 (])"
      >
        뒤 자르기
      </button>
      <button
        title="활성 트랙의 빈 구간을 전체 트랙에서 제거"
        onClick={() => {
          const result = gapRange(p, time, activeTrack);
          if (result.error) notify(result.error);
          else if (result.start !== undefined && result.end !== undefined)
            setPending({ base: p, start: result.start, end: result.end, time, track: activeTrack });
        }}
      >
        빈 구간 제거
      </button>
      <button
        disabled={!canEdit || members.length < 2}
        onClick={() => commit(groupClips(p, selected))}
      >
        선택 클립 그룹화
      </button>
      <button
        disabled={!canEdit || !members.some((c) => c.groupId)}
        onClick={() => commit(groupClips(p, selected, true))}
      >
        그룹 해제
      </button>
      {pending ? (
        <div className="modal-backdrop">
          <div
            className="help-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="빈 구간 제거 영향"
            tabIndex={-1}
            ref={dialog}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape') setPending(undefined);
              if (e.key === 'Tab') {
                const buttons =
                  dialog.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
                if (
                  e.shiftKey &&
                  (document.activeElement === buttons[0] ||
                    document.activeElement === dialog.current)
                ) {
                  e.preventDefault();
                  buttons[buttons.length - 1]?.focus();
                } else if (!e.shiftKey && document.activeElement === buttons[buttons.length - 1]) {
                  e.preventDefault();
                  buttons[0]?.focus();
                }
              }
            }}
          >
            <h2>전체 트랙의 구간 제거</h2>
            <p>
              {seconds(pending.start).toFixed(3)}–{seconds(pending.end).toFixed(3)}초 ·{' '}
              {seconds(pending.end - pending.start).toFixed(3)}초를 모든 트랙에서 제거합니다.
            </p>
            <p>활성 트랙은 비어 있어도 다른 트랙의 영상·음악·자막은 잘릴 수 있습니다.</p>
            <ul className="gap-impact">
              {affected.slice(0, 100).map((c) => (
                <li key={c.id}>
                  <strong>
                    {p.tracks.find((t) => t.id === c.trackId)?.name} · {c.name}
                  </strong>{' '}
                  — {c.start < pending.end ? '내용 삭제·트리밍/분할' : '앞으로 이동'}
                </li>
              ))}
            </ul>
            <p>
              총 {affected.length}개 클립에 영향을 줍니다.
              {affected.length > 100 ? ' 목록은 앞의 100개까지 표시합니다.' : ''}
            </p>
            {p !== pending.base ? (
              <p role="alert">편집이 변경됐습니다. 닫고 영향을 다시 확인하세요.</p>
            ) : null}
            <div className="modal-actions">
              <button className="secondary" onClick={() => setPending(undefined)}>
                취소
              </button>
              <button
                className="primary"
                disabled={p !== pending.base}
                onClick={() => {
                  const result = deleteGap(p, pending.time, pending.track);
                  if (result.error) notify(result.error);
                  else commit(result.project);
                  setPending(undefined);
                }}
              >
                전체 트랙에서 제거
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
