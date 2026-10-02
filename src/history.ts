import type { Project } from './model';
export class History {
  past: Project[] = [];
  future: Project[] = [];
  commit(current: Project, next: Project) {
    if (current === next || JSON.stringify(current) === JSON.stringify(next)) return current;
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
