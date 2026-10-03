import {
  useEffect,
  useRef,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
} from 'react';
export function IconButton({
  label,
  children,
  active,
  className = '',
  ...props
}: ComponentProps<'button'> & {
  label: string;
  active?: boolean;
}) {
  return (
    <button
      {...props}
      type="button"
      className={`icon-button ${active ? 'active' : ''} ${className}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

// Closed details, hidden panels and disabled fieldsets must not trap keyboard focus.
export function trapDialogFocus(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== 'Tab') return;
  const root = event.currentTarget;
  const controls = Array.from(
    root.querySelectorAll<HTMLElement>(
      'button,input,select,textarea,a[href],summary,video[controls],[tabindex="0"]',
    ),
  ).filter((el) => !el.matches(':disabled,[type="hidden"]') && el.getClientRects().length > 0);
  const first = controls[0],
    last = controls.at(-1);
  if (!first) {
    event.preventDefault();
    root.focus();
  } else if (
    event.shiftKey &&
    (document.activeElement === first || document.activeElement === root)
  ) {
    event.preventDefault();
    last?.focus();
  } else if (
    !event.shiftKey &&
    (document.activeElement === last || document.activeElement === root)
  ) {
    event.preventDefault();
    first.focus();
  }
}

// Shared by the two existing button-list popovers; their commands stay unchanged.
export function usePopup(open: boolean, setOpen: Dispatch<SetStateAction<boolean>>) {
  const ref = useRef<HTMLDivElement>(null),
    wasOpen = useRef(false);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const trigger = root.querySelector<HTMLButtonElement>(':scope > button');
    if (!open) {
      if (wasOpen.current && document.activeElement === document.body) trigger?.focus();
      wasOpen.current = false;
      return;
    }
    wasOpen.current = true;
    const controls = () =>
      Array.from(root.querySelectorAll<HTMLButtonElement>('.small-menu button:not(:disabled)'));
    controls()[0]?.focus();
    const outside = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!root.querySelector('.small-menu')?.contains(target) && !trigger?.contains(target))
        setOpen(false);
    };
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.isComposing) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        trigger?.focus();
      } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
        e.preventDefault();
        const items = controls(),
          index = items.indexOf(document.activeElement as HTMLButtonElement);
        const next =
          e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? items.length - 1
              : (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    root.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', outside);
      root.removeEventListener('keydown', key);
    };
  }, [open, setOpen]);
  return ref;
}
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export const formatBytes = (size: number) =>
  size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.round(size / 1024)} KB`;

export function shortFilename(name: string) {
  const characters = Array.from(name);
  return characters.length > 60
    ? `${characters.slice(0, 36).join('')}…${characters.slice(-16).join('')}`
    : name;
}
