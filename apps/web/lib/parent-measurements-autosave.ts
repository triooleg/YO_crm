export type SaveState = 'saved' | 'pending' | 'saving' | 'error' | 'conflict';

/** One queue per child. A response advances CAS only; it never replaces the editor's newer draft. */
export class DraftAutosave<T> {
  revision: number;
  state: SaveState = 'saved';
  errorStatus = 0;
  private latest: T | undefined;
  private version = 0;
  private savedVersion = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private disposed = false;
  private save: (revision: number, draft: T) => Promise<{ revision: number }>;
  private notify: (state: SaveState) => void;
  private delay: number;

  constructor(revision: number, save: (revision: number, draft: T) => Promise<{ revision: number }>, notify: (state: SaveState) => void, delay = 700) {
    this.revision = revision; this.save = save; this.notify = notify; this.delay = delay;
  }
  get dirty() { return this.version !== this.savedVersion; }
  private status(state: SaveState) { this.state = state; if (!this.disposed) this.notify(state); }
  edit(draft: T) {
    if (this.disposed) return;
    this.latest = structuredClone(draft); this.version++;
    clearTimeout(this.timer);
    if (this.state === 'conflict') return;
    this.status('pending');
    this.timer = setTimeout(() => { void this.flush().catch(() => { /* Exposed as error/conflict; never claim success. */ }); }, this.delay);
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.state === 'conflict') throw new Error('conflict');
    if (this.disposed) throw new Error('disposed');
    if (this.running) { await this.running; if (this.dirty) return this.flush(); return; }
    if (!this.dirty) return;
    this.running = this.drain();
    try { await this.running; } finally { this.running = undefined; }
  }
  private async drain() {
    while (this.dirty && !this.disposed) {
      const version = this.version, draft = this.latest!;
      this.status('saving');
      try {
        const response = await this.save(this.revision, draft);
        this.revision = response.revision; this.savedVersion = version; this.errorStatus = 0;
      } catch (error) {
        this.errorStatus = (error as { status?: number }).status ?? 0;
        this.status((error as { status?: number }).status === 409 ? 'conflict' : 'error');
        throw error;
      }
    }
    if (!this.disposed) this.status('saved');
  }
  dispose() { this.disposed = true; clearTimeout(this.timer); }
}
