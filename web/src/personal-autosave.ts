/**
 * Serialize personal preference autosaves. Initial hydration never submits
 * a write; a stale network response cannot replace a newer draft. No auth
 * tokens, cookies, DAV passwords, or other secrets may enter this queue.
 */
export type SaveStatus = 'loading' | 'pending' | 'saving' | 'saved' | 'error';

const signature = (value: unknown): string => JSON.stringify(value, (_key, entry: unknown) => {
  if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
    return Object.fromEntries(Object.entries(entry).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0));
  }
  return entry;
});

export class PersonalAutosave<T> {
  private baseline: string | null = null;
  private latest: {key: string; value: T} | null = null;
  private saving = false;
  private paused = false;
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly persist: (value: T) => Promise<unknown>,
    private readonly status: (state: SaveStatus) => void,
    private readonly delayMs = 650,
  ) {}

  hydrate(value: T): void {
    if (this.disposed) return;
    this.cancelTimer();
    this.baseline = signature(value);
    this.latest = null;
    this.paused = false;
    this.status('saved');
  }

  change(value: T): void {
    if (this.disposed || this.baseline === null) return;
    const key = signature(value);
    this.paused = false;
    if (!this.saving && key === this.baseline) {
      this.cancelTimer();
      this.latest = null;
      this.status('saved');
      return;
    }
    this.latest = {key, value};
    this.status('pending');
    this.schedule();
  }

  pause(): void {
    if (this.disposed) return;
    this.paused = true;
    this.cancelTimer();
    this.latest = null;
    this.status('error');
  }

  retry(): void {
    if (this.disposed || this.paused || !this.latest) return;
    this.cancelTimer();
    void this.flush();
  }

  dispose(): void {
    this.disposed = true;
    this.cancelTimer();
    this.latest = null;
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private schedule(): void {
    this.cancelTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.delayMs);
  }

  private async flush(): Promise<void> {
    if (this.disposed || this.paused || this.saving || !this.latest) return;
    const current = this.latest;
    if (current.key === this.baseline) {
      this.latest = null;
      this.status('saved');
      return;
    }
    this.saving = true;
    this.status('saving');
    let failed = false;
    try {
      await this.persist(current.value);
      this.baseline = current.key;
      if (!this.disposed && !this.paused && this.latest?.key === current.key) {
        this.latest = null;
        this.status('saved');
      }
    } catch {
      failed = true;
      if (!this.disposed && !this.paused && this.latest?.key === current.key) {
        this.status('error');
      }
    } finally {
      this.saving = false;
      if (!this.disposed && !this.paused && this.latest && this.latest.key !== current.key) {
        this.schedule();
      } else if (!this.disposed && !this.paused && !failed && !this.latest) {
        this.status('saved');
      }
    }
  }
}
