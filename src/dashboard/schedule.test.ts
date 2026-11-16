import { describe, expect, it, vi } from 'vitest';
import { PushScheduler, clampMinutes, describeSchedule, isDue } from './schedule';

const MIN = 60_000;

function setup() {
  let now = 1_000_000;
  const run = vi.fn(async (_id: string) => {});
  const s = new PushScheduler(run, { now: () => now });
  return { s, run, advance: (min: number) => { now += min * MIN; }, at: () => now };
}

describe('PushScheduler', () => {
  it('first push is one full interval after the job appears', async () => {
    const { s, run, advance } = setup();
    s.sync([{ id: 'a', everyMinutes: 15 }]);
    advance(14);
    await s.tick();
    expect(run).not.toHaveBeenCalled();
    advance(1);
    await s.tick();
    expect(run).toHaveBeenCalledWith('a');
  });

  it('records the outcome and schedules the next push from the last one', async () => {
    const { s, advance, at } = setup();
    s.sync([{ id: 'a', everyMinutes: 10 }]);
    advance(10);
    await s.tick();
    const st = s.state('a')!;
    expect(st.lastOk).toBe(true);
    expect(st.lastAt).toBe(at());
    expect(st.nextAt).toBe(at() + 10 * MIN);
  });

  it('marks a failed push and keeps going', async () => {
    const { s, run, advance } = setup();
    run.mockRejectedValueOnce(new Error('offline'));
    s.sync([{ id: 'a', everyMinutes: 5 }]);
    advance(5);
    await s.tick();
    expect(s.state('a')?.lastOk).toBe(false);
    advance(5);
    await s.tick();
    expect(s.state('a')?.lastOk).toBe(true);
  });

  it('waits while it may not run, then runs the overdue job at the next tick', async () => {
    let allowed = false;
    let now = 1_000_000;
    const run = vi.fn(async (_id: string) => {});
    const s = new PushScheduler(run, { now: () => now, canRun: () => allowed });
    s.sync([{ id: 'a', everyMinutes: 5 }]);
    now += 6 * MIN;
    await s.tick();
    expect(run).not.toHaveBeenCalled();
    expect(s.state('a')!.lastAt).toBeNull();
    allowed = true;
    await s.tick();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('asks per job: one that may not run is skipped while the others go ahead', async () => {
    let now = 1_000_000;
    const run = vi.fn(async (_id: string) => {});
    const s = new PushScheduler(run, { now: () => now, canRun: (id) => id !== 'usb' });
    s.sync([{ id: 'wifi', everyMinutes: 5 }, { id: 'usb', everyMinutes: 5 }]);
    now += 6 * MIN;
    await s.tick();
    expect(run.mock.calls.map((c) => c[0])).toEqual(['wifi']);
    expect(s.state('usb')!.lastAt).toBeNull();
  });

  it('does not start a job that is still running', async () => {
    const { s, run, advance } = setup();
    let release = () => {};
    run.mockImplementationOnce(() => new Promise<void>((r) => { release = r; }));
    s.sync([{ id: 'a', everyMinutes: 1 }]);
    advance(1);
    const first = s.tick();
    advance(5);
    await s.tick();
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await first;
  });

  it('restarts a job whose interval changed, keeps one that did not, drops one that went away', () => {
    const { s, advance } = setup();
    s.sync([{ id: 'a', everyMinutes: 10 }, { id: 'b', everyMinutes: 10 }]);
    const nextA = s.state('a')!.nextAt;
    advance(4);
    s.sync([{ id: 'a', everyMinutes: 10 }]);
    expect(s.state('a')!.nextAt).toBe(nextA);
    expect(s.state('b')).toBeUndefined();
    s.sync([{ id: 'a', everyMinutes: 30 }]);
    expect(s.state('a')!.nextAt).toBe(nextA + 4 * MIN + 20 * MIN);
  });

  it('counts a manual push as a run', () => {
    const { s, advance, at } = setup();
    s.sync([{ id: 'a', everyMinutes: 10 }]);
    advance(7);
    s.record('a', true);
    expect(s.state('a')!.nextAt).toBe(at() + 10 * MIN);
  });

  it('never schedules faster than once a minute', () => {
    expect(clampMinutes(0)).toBe(1);
    expect(clampMinutes(0.2)).toBe(1);
    expect(clampMinutes(12.6)).toBe(13);
    expect(clampMinutes(Number.NaN)).toBe(30);
  });
});

describe('describeSchedule', () => {
  const fmt = (at: number) => `t${at}`;
  const base = { id: 'a', everyMinutes: 15, nextAt: 1_000_000 + 12 * MIN, lastAt: null, lastOk: null, running: false };

  it('says when the next push is', () => {
    expect(describeSchedule(base, 1_000_000, fmt)).toBe('Next push in 12 min');
    expect(describeSchedule({ ...base, nextAt: 1_000_000 + 20_000 }, 1_000_000, fmt)).toBe('Next push in under a minute');
    expect(describeSchedule({ ...base, nextAt: 1_000_000 + 12 * MIN + 400 }, 1_000_000, fmt)).toBe('Next push in 12 min');
    expect(describeSchedule({ ...base, nextAt: 1_000_000 - 5000 }, 1_000_000, fmt)).toBe('Next push in under a minute');
  });

  it('adds the last result', () => {
    expect(describeSchedule({ ...base, lastAt: 5, lastOk: true }, 1_000_000, fmt)).toBe('Next push in 12 min · Last push t5 ok');
    expect(describeSchedule({ ...base, lastAt: 5, lastOk: false }, 1_000_000, fmt)).toContain('failed');
  });

  it('says it is pushing, and nothing for no job', () => {
    expect(describeSchedule({ ...base, running: true }, 1_000_000, fmt)).toBe('Pushing now');
    expect(describeSchedule(undefined, 0, fmt)).toBe('');
  });

  it('isDue waits for the time and for a free slot', () => {
    expect(isDue(base, base.nextAt - 1)).toBe(false);
    expect(isDue(base, base.nextAt)).toBe(true);
    expect(isDue({ ...base, running: true }, base.nextAt + 1)).toBe(false);
  });
});
