/** A heartbeat only counts when the stage or completed work actually changes. */
export class ProgressWatch {
  private timer?: ReturnType<typeof setTimeout>;
  private last = '';
  private stopped = false;
  constructor(
    private expired: () => void,
    private timeout = 120_000,
  ) {
    this.advance('start');
  }
  advance(key: string) {
    if (this.stopped || key === this.last) return;
    this.last = key;
    clearTimeout(this.timer);
    this.timer = setTimeout(this.expired, this.timeout);
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
