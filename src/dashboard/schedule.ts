// Auto-push timing, free of Vue and of the API so it can be tested with a fake clock.
// One ticker checks every job against the wall clock (not a timer per job), which keeps it correct after the computer sleeps.

export const clampMinutes = (n: number) => Math.max(1, Math.round(Number.isFinite(n) ? n : 30));

export type Job = { id: string; everyMinutes: number };
export type JobState = {
  id: string;
  everyMinutes: number;
  /** epoch ms of the next push */
  nextAt: number;
  /** epoch ms of the last push, null before the first one */
  lastAt: number | null;
  lastOk: boolean | null;
  running: boolean;
};

export const isDue = (s: JobState, now: number) => !s.running && now >= s.nextAt;

export class PushScheduler {
  private jobs = new Map<string, JobState>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly run: (id: string) => Promise<void>,
    private readonly opts: {
      now?: () => number;
      tickMs?: number;
      onChange?: () => void;
      /** when it says no, a tick does nothing: due jobs stay due and run at the first tick that says yes */
      canRun?: () => boolean;
    } = {},
  ) {}

  private now() { return (this.opts.now ?? Date.now)(); }

  /** Makes the job set match `jobs`: new ones start a full interval from now, changed intervals restart, missing ones stop. */
  sync(jobs: Job[]): void {
    const keep = new Set(jobs.map((j) => j.id));
    for (const id of [...this.jobs.keys()]) if (!keep.has(id)) this.jobs.delete(id);
    for (const j of jobs) {
      const every = clampMinutes(j.everyMinutes);
      const cur = this.jobs.get(j.id);
      if (cur && cur.everyMinutes === every) continue;
      this.jobs.set(j.id, {
        id: j.id, everyMinutes: every, nextAt: this.now() + every * 60_000,
        lastAt: cur?.lastAt ?? null, lastOk: cur?.lastOk ?? null, running: cur?.running ?? false,
      });
    }
    this.opts.onChange?.();
  }

  state(id: string): JobState | undefined { return this.jobs.get(id); }

  /** a manual push counts as a run: the next automatic one is a full interval away */
  record(id: string, ok: boolean): void {
    const s = this.jobs.get(id);
    if (!s) return;
    s.lastAt = this.now();
    s.lastOk = ok;
    s.nextAt = s.lastAt + s.everyMinutes * 60_000;
    this.opts.onChange?.();
  }

  async tick(): Promise<void> {
    if (this.opts.canRun && !this.opts.canRun()) return;
    const due = [...this.jobs.values()].filter((s) => isDue(s, this.now()));
    await Promise.all(due.map(async (s) => {
      s.running = true;
      this.opts.onChange?.();
      let ok = true;
      try { await this.run(s.id); } catch { ok = false; }
      s.running = false;
      this.record(s.id, ok);
    }));
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.opts.tickMs ?? 15_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

/** "Next push in 12 min" / "Last push 14:02 ok" for the status line; `fmtTime` formats an epoch for the user's locale */
export function describeSchedule(s: JobState | undefined, now: number, fmtTime: (at: number) => string): string {
  if (!s) return '';
  const parts: string[] = [];
  if (s.running) parts.push('Pushing now');
  else {
    const mins = Math.round((s.nextAt - now) / 60_000);
    parts.push(mins < 1 ? 'Next push in under a minute' : `Next push in ${mins} min`);
  }
  if (s.lastAt !== null) parts.push(`Last push ${fmtTime(s.lastAt)} ${s.lastOk ? 'ok' : 'failed'}`);
  return parts.join(' · ');
}
