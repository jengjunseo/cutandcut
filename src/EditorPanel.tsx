import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton, trapDialogFocus } from './ui';

/** Keep the actual editor panels mounted, including unfinished text input. */
export default function EditorPanel({
  mobile,
  open,
  docked = false,
  title,
  close,
  children,
}: {
  mobile: boolean;
  open: boolean;
  docked?: boolean;
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const onClose = useRef(close);
  onClose.current = close;
  useEffect(() => {
    if (!mobile || !open) return;
    const panel = root.current;
    const previous = document.activeElement as HTMLElement | null;
    panel?.focus();
    let frame = 0;
    const revealInput = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const focused = document.activeElement as HTMLElement | null;
        if (focused?.matches('input,textarea,select') && root.current?.contains(focused)) {
          focused.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
      });
    };
    window.visualViewport?.addEventListener('resize', revealInput);
    return () => {
      cancelAnimationFrame(frame);
      window.visualViewport?.removeEventListener('resize', revealInput);
      const active = document.activeElement;
      // Nonmodal navigation may explicitly focus the preview or timeline.
      if (previous?.isConnected && (active === document.body || panel?.contains(active)))
        previous.focus();
    };
  }, [mobile, open]);
  return (
    <div
      className={`editor-panel-slot ${mobile ? 'mobile-sheet' : ''} ${docked ? 'sheet-docked' : ''}`}
      hidden={mobile && !open}
      ref={root}
      tabIndex={mobile && open ? -1 : undefined}
      role={mobile && open ? (docked ? 'region' : 'dialog') : undefined}
      aria-modal={mobile && open && !docked ? true : undefined}
      aria-label={mobile ? title : undefined}
      onKeyDown={(event) => {
        if (!mobile || !open || event.nativeEvent.isComposing) return;
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.stopPropagation();
          onClose.current();
        }
        if (!docked && !(event.target as HTMLElement).closest('.modal-backdrop')) {
          event.stopPropagation();
          trapDialogFocus(event);
        }
      }}
    >
      {mobile && open ? (
        <>
          {!docked ? <div className="sheet-scrim" aria-hidden="true" onClick={close} /> : null}
          <div className="sheet-heading">
            <h2>{title}</h2>
            <IconButton label={`${title} 닫기`} onClick={close}>
              <X size={20} />
            </IconButton>
          </div>
        </>
      ) : null}
      {children}
    </div>
  );
}
