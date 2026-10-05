import type { Track } from './model';
import { NameInput } from './ui';

export default function TrackSettings({
  track,
  index,
  count,
  patch,
  reorder,
  remove,
}: {
  track: Track;
  index: number;
  count: number;
  patch: (value: Partial<Track>) => void;
  reorder: (direction: number) => void;
  remove: () => void;
}) {
  return (
    <div className="mobile-track-settings">
      <label className="field">
        <span>트랙 이름</span>
        <NameInput
          label={`${track.name} 이름`}
          name={track.name}
          onCommit={(name) => patch({ name: name || track.name })}
        />
      </label>
      <div className="mobile-track-actions">
        <button aria-pressed={track.locked} onClick={() => patch({ locked: !track.locked })}>
          {track.locked ? '잠금 해제' : '잠금'}
        </button>
        <button
          aria-pressed={track.kind === 'audio' ? track.muted : track.hidden}
          onClick={() =>
            patch(track.kind === 'audio' ? { muted: !track.muted } : { hidden: !track.hidden })
          }
        >
          {track.kind === 'audio'
            ? track.muted
              ? '음소거 해제'
              : '음소거'
            : track.hidden
              ? '표시'
              : '숨기기'}
        </button>
        <button aria-pressed={track.solo ?? false} onClick={() => patch({ solo: !track.solo })}>
          단독 재생
        </button>
        <button disabled={index === 0} onClick={() => reorder(-1)}>
          위로 이동
        </button>
        <button disabled={index === count - 1} onClick={() => reorder(1)}>
          아래로 이동
        </button>
        <button disabled={track.locked} onClick={remove}>
          트랙 삭제
        </button>
      </div>
      <p className="small-note">
        위쪽 영상 트랙이 위에 합성됩니다. 잠긴 연결·그룹 클립이 있으면 삭제하지 않습니다.
      </p>
    </div>
  );
}
