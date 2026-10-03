import type { Project } from './model';
/** Share unchanged branches; avoid serializing thumbnails and waveforms on every edit. */
function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const left = a as Record<string, unknown>,
    right = b as Record<string, unknown>;
  const keys = Object.keys(left).filter((key) => left[key] !== undefined);
  return (
    keys.length === Object.keys(right).filter((key) => right[key] !== undefined).length &&
    keys.every((key) => Object.hasOwn(right, key) && sameValue(left[key], right[key]))
  );
}
export class History {
  past: Project[] = [];
  future: Project[] = [];
  commit(current: Project, next: Project) {
    if (sameValue(current, next)) return current;
    this.past.push(current);
    if (this.past.length > 80) this.past.shift();
    this.future = [];
    return next;
  }
  undo(current: Project) {
    const previous = this.past.pop();
    if (!previous) return current;
    this.future.push(current);
    return previous;
  }
  redo(current: Project) {
    const next = this.future.pop();
    if (!next) return current;
    this.past.push(current);
    return next;
  }
  clear() {
    this.past = [];
    this.future = [];
  }
}
