// Undo/redo over immutable snapshots. States share structure (an edit copies only what it changes), so keeping
// many of them is cheap even when a document carries embedded images.

export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  private base: T | null = null;
  private lastKey: string | null = null;
  private lastAt = 0;

  constructor(
    public present: T,
    private readonly limit = 100,
    private readonly now: () => number = Date.now,
  ) {}

  get canUndo() { return this.past.length > 0 || this.base !== null; }
  get canRedo() { return this.future.length > 0; }

  /**
   * Records an undoable change. Edits with the same `key` within `mergeMs` of each other fold into one step,
   * so typing a word is one undo, not one per letter.
   */
  push(next: T, key: string | null = null, mergeMs = 900): void {
    if (next === this.present) return;
    this.settle();
    const t = this.now();
    const merge = key !== null && key === this.lastKey && t - this.lastAt < mergeMs && this.past.length > 0;
    if (!merge) {
      this.past.push(this.present);
      if (this.past.length > this.limit) this.past.shift();
    }
    this.present = next;
    this.future = [];
    this.lastKey = key;
    this.lastAt = t;
  }

  /** A change that is part of a continuous gesture (a drag): visible at once, recorded as one step by `settle`. */
  live(next: T): void {
    if (this.base === null) {
      this.base = this.present;
      this.future = [];
    }
    this.present = next;
  }

  /** Ends the gesture; returns whether it changed anything. */
  settle(): boolean {
    if (this.base === null) return false;
    const base = this.base;
    this.base = null;
    if (base === this.present) return false;
    this.past.push(base);
    if (this.past.length > this.limit) this.past.shift();
    this.lastKey = null;
    return true;
  }

  /** Drops the gesture and restores the state it started from. */
  abort(): void {
    if (this.base === null) return;
    this.present = this.base;
    this.base = null;
  }

  undo(): boolean {
    this.settle();
    const prev = this.past.pop();
    if (prev === undefined) return false;
    this.future.push(this.present);
    this.present = prev;
    this.lastKey = null;
    return true;
  }

  redo(): boolean {
    this.settle();
    const next = this.future.pop();
    if (next === undefined) return false;
    this.past.push(this.present);
    this.present = next;
    this.lastKey = null;
    return true;
  }
}
