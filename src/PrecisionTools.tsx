import { type Project, linked, editable } from './model';
import { clipBoundary, trimToHead, markRange, deleteGap, groupClips } from './editing';
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
          const result = deleteGap(p, time, activeTrack);
          if (result.error) notify(result.error);
          else commit(result.project);
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
    </div>
  );
}
