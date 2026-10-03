import { useEffect, useRef, useState } from 'react';
import { recentProjects, type SavedProject } from './storage';
import { seconds, duration, type Project } from './model';
import { formatBytes, IconButton, trapDialogFocus } from './ui';
import { LoaderCircle, X } from 'lucide-react';
export default function RecentProjects({
  close,
  open,
  notify,
}: {
  close: () => void;
  open: (p: Project) => Promise<void>;
  notify: (s: string) => void;
}) {
  const [rows, setRows] = useState<SavedProject[]>([]),
    [usage, setUsage] = useState('확인 중'),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    const old = document.activeElement as HTMLElement;
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    void recentProjects()
      .then((rows) => {
        if (live) {
          setRows(rows);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (live) {
          setError(e.message);
          setLoading(false);
        }
      });
    if (navigator.storage?.estimate)
      void navigator.storage
        .estimate()
        .then((e) => {
          if (live) setUsage(`${formatBytes(e.usage ?? 0)} / ${formatBytes(e.quota ?? 0)}`);
        })
        .catch(() => {
          if (live) setUsage('확인할 수 없음');
        });
    else setUsage('이 환경에서는 확인할 수 없음');
    return () => {
      live = false;
      old?.focus();
    };
  }, [notify]);
  return (
    <div className="modal-backdrop">
      <div
        className="help-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="최근 프로젝트"
        tabIndex={-1}
        ref={ref}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) close();
          trapDialogFocus(e);
        }}
      >
        <div className="dialog-heading">
          <h2>최근 프로젝트</h2>
          <IconButton label="최근 프로젝트 닫기" disabled={busy} onClick={close}>
            <X size={18} />
          </IconButton>
        </div>
        <p>기기 저장소 사용량 {usage}</p>
        <p className="small-note">
          프로젝트 복제와 복구 지점은 같은 원본을 참조합니다. 별도 백업은 프로젝트 JSON과 원본
          파일을 함께 보관하세요.
        </p>
        {busy ? (
          <p className="checking" role="status">
            <LoaderCircle size={16} className="spin" />
            현재 작업을 저장하고 프로젝트를 여는 중…
          </p>
        ) : null}
        <div className="recent-list" aria-busy={loading || busy}>
          {rows.map((row) => (
            <button
              className="secondary"
              disabled={busy}
              key={row.project.id}
              onClick={() => {
                setBusy(true);
                void open(row.project)
                  .then(close)
                  .catch((e) => {
                    notify(e.message);
                    setBusy(false);
                  });
              }}
            >
              <strong>{row.project.name}</strong>
              <span>
                {new Date(row.updatedAt).toLocaleString('ko-KR')} ·{' '}
                {seconds(duration(row.project)).toFixed(1)}초 · 원본 {row.project.assets.length}개
              </span>
            </button>
          ))}
          {loading ? (
            <p className="checking" role="status">
              <LoaderCircle size={16} className="spin" />
              저장된 프로젝트를 불러오는 중…
            </p>
          ) : error ? (
            <p className="warning" role="alert">
              프로젝트 목록을 불러오지 못했습니다. {error} 편집으로 돌아가 현재 작업을 계속할 수
              있습니다.
            </p>
          ) : !rows.length ? (
            <p className="empty-state">
              저장된 프로젝트가 없습니다. 편집을 시작하면 이 기기에 자동 저장됩니다.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
