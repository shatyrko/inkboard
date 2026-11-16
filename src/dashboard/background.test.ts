import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublishResult } from '../lib/types';
import { createBackground, type BackgroundDeps } from './background';
import { newDashboard, type Dashboard } from './model';

const MIN = 60_000;
const TICK = 1000;
const result: PublishResult = { path: 'Document/Dashboards/x.pdf', entryId: 'e', pages: 1, bytes: 10 };

const scheduled = (name: string, everyMinutes = 5, enabled = true): Dashboard => ({ ...newDashboard(name), schedule: { enabled, everyMinutes } });

function setup(over: Partial<BackgroundDeps> = {}) {
  let t = 1_000_000;
  let connected = true;
  const push = vi.fn(async (_d: Dashboard, _onProgress: (p: { stage: 'data' | 'render' | 'upload' }) => void) => result);
  const onScheduledFailure = vi.fn();
  const bg = createBackground({
    loadAll: async () => [],
    push,
    exportPdf: vi.fn(async () => {}),
    isReachable: () => connected,
    onScheduledFailure,
    now: () => t,
    tickMs: TICK,
    ...over,
  });
  bg.start();
  return {
    bg, push, onScheduledFailure,
    /** lets `min` minutes pass and the ticker fire once */
    pass: async (min: number) => { t += min * MIN; await vi.advanceTimersByTimeAsync(TICK); },
    setConnected: (v: boolean) => { connected = v; },
  };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('automatic pushes', () => {
  it('push a scheduled dashboard once its interval has passed, without any view', async () => {
    const { bg, push, pass } = setup();
    const d = scheduled('Wall');
    bg.put(d);
    await pass(4);
    expect(push).not.toHaveBeenCalled();
    await pass(1);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0]).toBe(d);
    bg.stop();
  });

  it('ignore dashboards without a schedule and stop when it is switched off', async () => {
    const { bg, push, pass } = setup();
    bg.put(scheduled('Off', 5, false));
    const on = scheduled('On');
    bg.put(on);
    bg.put({ ...on, schedule: { enabled: false, everyMinutes: 5 } });
    await pass(10);
    expect(push).not.toHaveBeenCalled();
    bg.stop();
  });

  it('push the newest version of a dashboard', async () => {
    const { bg, push, pass } = setup();
    const d = scheduled('Wall');
    bg.put(d);
    const edited = { ...d, name: 'Wall v2' };
    bg.put(edited);
    await pass(5);
    expect(push.mock.calls[0][0]).toBe(edited);
    bg.stop();
  });

  it('wait while the reader is not connected and push at the next tick after it is', async () => {
    const { bg, push, pass, setConnected } = setup();
    bg.put(scheduled('Wall'));
    setConnected(false);
    await pass(6);
    await pass(1);
    expect(push).not.toHaveBeenCalled();
    setConnected(true);
    await pass(0);
    expect(push).toHaveBeenCalledTimes(1);
    bg.stop();
  });

  it('start twice does not run a job twice, stop ends the ticking', async () => {
    const { bg, push, pass } = setup();
    bg.start();
    bg.put(scheduled('Wall'));
    await pass(5);
    expect(push).toHaveBeenCalledTimes(1);
    bg.stop();
    await pass(10);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('count a manual push as a run for the schedule', async () => {
    const { bg, push, pass } = setup();
    const d = scheduled('Wall');
    bg.put(d);
    await pass(4);
    await bg.push(d);
    await pass(4);
    expect(push).toHaveBeenCalledTimes(1);
    await pass(1);
    expect(push).toHaveBeenCalledTimes(2);
    bg.stop();
  });
});

describe('lastPush', () => {
  it('records every successful push, automatic or manual, and not the failed ones', async () => {
    const { bg, push, pass } = setup();
    const d = scheduled('Wall');
    bg.put(d);
    expect(bg.lastPush.value).toBeNull();
    await pass(5);
    expect(bg.lastPush.value).toMatchObject({ id: d.id });
    const first = bg.lastPush.value;
    push.mockRejectedValueOnce('offline');
    await expect(bg.push(d)).rejects.toBe('offline');
    expect(bg.lastPush.value).toBe(first);
    await bg.push(d);
    expect(bg.lastPush.value).not.toBe(first);
    bg.stop();
  });
});

describe('per-reader reachability', () => {
  it('skips a dashboard whose reader is gone while another one is pushed', async () => {
    let usbPlugged = false;
    const { bg, push, pass } = setup({ isReachable: (d) => d.name !== 'Usb' || usbPlugged });
    const dpt = scheduled('Wall');
    const usb = scheduled('Usb');
    bg.put(dpt);
    bg.put(usb);
    await pass(5);
    expect(push.mock.calls.map((c) => c[0].name)).toEqual(['Wall']);
    usbPlugged = true;
    await pass(0);
    expect(push.mock.calls.map((c) => c[0].name)).toEqual(['Wall', 'Usb']);
    bg.stop();
  });
});

describe('failures', () => {
  it('toast once per failing streak, again after a success', async () => {
    const { bg, push, onScheduledFailure, pass } = setup();
    bg.put(scheduled('Wall'));
    push.mockRejectedValueOnce('no route to the reader').mockRejectedValueOnce('no route to the reader').mockResolvedValueOnce(result).mockRejectedValueOnce(new Error('timed out'));
    await pass(5);
    await pass(5);
    expect(onScheduledFailure).toHaveBeenCalledTimes(1);
    expect(onScheduledFailure.mock.calls[0][1]).toBe('no route to the reader');
    await pass(5);
    await pass(5);
    expect(push).toHaveBeenCalledTimes(4);
    expect(onScheduledFailure).toHaveBeenCalledTimes(2);
    expect(onScheduledFailure.mock.calls[1][1]).toBe('timed out');
    bg.stop();
  });

  it('show the failed run in the status line', async () => {
    const { bg, push, pass } = setup();
    const d = scheduled('Wall');
    bg.put(d);
    push.mockRejectedValueOnce('offline');
    await pass(5);
    expect(bg.scheduleText(d.id)).toMatch(/Last push .* failed/);
    bg.stop();
  });

  it('reject a manual push that fails, leaving the toast to the caller', async () => {
    const { bg, push, onScheduledFailure } = setup();
    const d = scheduled('Wall');
    push.mockRejectedValueOnce('disk full');
    await expect(bg.push(d)).rejects.toBe('disk full');
    expect(onScheduledFailure).not.toHaveBeenCalled();
    bg.stop();
  });
});

describe('one push at a time', () => {
  it('queues a manual push behind a running automatic one and shows who has the turn', async () => {
    const { bg, push, pass } = setup();
    const a = scheduled('A');
    const b = newDashboard('B');
    bg.put(a);
    let release = () => {};
    push.mockImplementationOnce((_d, onProgress) => new Promise<PublishResult>((r) => { onProgress({ stage: 'render' }); release = () => r(result); }));
    await pass(5);
    expect(bg.busy.value).toEqual({ id: a.id, progress: { stage: 'render' } });

    const manual = bg.push(b);
    await vi.advanceTimersByTimeAsync(0);
    expect(push).toHaveBeenCalledTimes(1);
    release();
    await manual;
    expect(push).toHaveBeenCalledTimes(2);
    expect(push.mock.calls[1][0]).toBe(b);
    expect(bg.busy.value).toBeNull();
    bg.stop();
  });

  it('exports through the same lock', async () => {
    const exportPdf = vi.fn(async () => {});
    const { bg } = setup({ exportPdf });
    const d = newDashboard('A');
    await bg.exportPdf(d, '/tmp/a.pdf');
    expect(exportPdf).toHaveBeenCalledWith(d, '/tmp/a.pdf', expect.any(Function));
    expect(bg.busy.value).toBeNull();
    bg.stop();
  });
});

describe('loading', () => {
  it('load every stored dashboard once, keeping newer ones already in memory', async () => {
    const stored = scheduled('Stored');
    const old = scheduled('Open');
    const newer = { ...old, name: 'Open (edited)' };
    const loadAll = vi.fn(async () => [stored, old]);
    const { bg } = setup({ loadAll });
    bg.put(newer);
    await bg.ensureLoaded();
    await bg.ensureLoaded();
    expect(loadAll).toHaveBeenCalledTimes(1);
    expect(bg.docs.get(stored.id)).toBe(stored);
    expect(bg.docs.get(old.id)).toBe(newer);
    bg.stop();
  });

  it('schedule dashboards that were only ever loaded, never opened', async () => {
    const stored = scheduled('Stored');
    const { bg, push, pass } = setup({ loadAll: async () => [stored] });
    await vi.advanceTimersByTimeAsync(0);
    await pass(5);
    expect(push).toHaveBeenCalledTimes(1);
    bg.stop();
  });

  it('try again after a failed load', async () => {
    const loadAll = vi.fn<() => Promise<Dashboard[]>>().mockRejectedValueOnce(new Error('unreadable')).mockResolvedValue([]);
    const { bg } = setup({ loadAll });
    await expect(bg.ensureLoaded()).rejects.toThrow('unreadable');
    await bg.ensureLoaded();
    expect(loadAll).toHaveBeenCalledTimes(2);
    bg.stop();
  });

  it('forget a deleted dashboard and its schedule', async () => {
    const { bg, push, pass } = setup();
    const d = scheduled('Wall');
    bg.put(d);
    bg.remove(d.id);
    await pass(10);
    expect(push).not.toHaveBeenCalled();
    expect(bg.docs.has(d.id)).toBe(false);
    bg.stop();
  });
});

describe('scheduleText', () => {
  it('says when the next push is, and nothing for a dashboard without a schedule', () => {
    const { bg } = setup();
    const d = scheduled('Wall', 15);
    bg.put(d);
    bg.put(newDashboard('Plain'));
    expect(bg.scheduleText(d.id)).toBe('Next push in 15 min');
    expect(bg.scheduleText([...bg.docs.keys()].find((id) => id !== d.id)!)).toBe('');
    expect(bg.scheduleText('missing')).toBe('');
    bg.stop();
  });
});
