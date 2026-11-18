import { useEffect, useRef } from 'react';
import { GripVertical } from 'lucide-react';
export type AssetPointerDetail = {
  phase: 'move' | 'drop' | 'cancel';
  ids: string[];
  x: number;
  y: number;
};
export const assetPointerEvent = 'cyancut-asset-placement';
export default function AssetDragHandle({
  name,
  ids,
  add,
  start,
  disabled,
}: {
  name: string;
  ids: string[];
  add: () => void;
  start: () => void;
  disabled: boolean;
}) {
  const stop = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => stop.current?.(), []);
  return (
    <button
      className="asset-drag-handle"
      disabled={disabled}
      aria-label={`${name} 끌어서 배치 · Enter는 재생헤드에 추가`}
      title="끌어서 배치 · Enter로 추가"
      onClick={(e) => {
        if (e.detail === 0) add();
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        start();
        const target = event.currentTarget,
          origin = { x: event.clientX, y: event.clientY };
        let moved = false,
          active = true;
        target.setPointerCapture(event.pointerId);
        const emit = (phase: AssetPointerDetail['phase'], e?: PointerEvent) =>
          window.dispatchEvent(
            new CustomEvent<AssetPointerDetail>(assetPointerEvent, {
              detail: { phase, ids, x: e?.clientX ?? origin.x, y: e?.clientY ?? origin.y },
            }),
          );
        const move = (e: PointerEvent) => {
          moved ||= Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > 6;
          if (moved) emit('move', e);
        };
        const clean = () => {
          active = false;
          target.removeEventListener('pointermove', move);
          target.removeEventListener('pointerup', end);
          target.removeEventListener('pointercancel', cancel);
          target.removeEventListener('lostpointercapture', cancel);
          window.removeEventListener('keydown', key);
          if (target.hasPointerCapture(event.pointerId))
            target.releasePointerCapture(event.pointerId);
          stop.current = undefined;
        };
        const end = (e: PointerEvent) => {
          clean();
          if (moved) emit('drop', e);
          else add();
        };
        const cancel = () => {
          if (!active) return;
          clean();
          emit('cancel');
        };
        const key = (e: KeyboardEvent) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
          }
        };
        target.addEventListener('pointermove', move);
        target.addEventListener('pointerup', end);
        target.addEventListener('pointercancel', cancel);
        target.addEventListener('lostpointercapture', cancel);
        window.addEventListener('keydown', key);
        stop.current = cancel;
      }}
    >
      <GripVertical size={16} />
      <span>끌어서 배치</span>
    </button>
  );
}
