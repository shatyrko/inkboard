import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POLL_MS, SETTLE_MS, createReaderPreview, dataUrlToBlob, shouldPoll, type Conditions } from './reader-preview';

const ALL: Conditions = { panelVisible: true, viewActive: true, windowVisible: true, connected: true };

function setup(capture = vi.fn(async () => 'data:image/png;base64,AAA'), timeoutMs?: number) {
  const onFailureStreak = vi.fn();
  let t = 5_000;
  const p = createReaderPreview({ capture, onFailureStreak, now: () => t, timeoutMs });
  return { p, capture, onFailureStreak, setNow: (v: number) => { t = v; } };
}
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('shouldPoll', () => {
  it('needs the panel on screen, the view active, the window visible and the reader connected', () => {
    expect(shouldPoll(ALL)).toBe(true);
    for (const key of Object.keys(ALL) as (keyof Conditions)[]) expect(shouldPoll({ ...ALL, [key]: false })).toBe(false);
  });
});

describe('polling', () => {
  it('takes a screenshot at once when everything lines up, then every five seconds', async () => {
    const { p, capture } = setup();
    p.update({ panelVisible: true, viewActive: true, connected: true });
    await flush();
    expect(capture).toHaveBeenCalledTimes(1);
    expect(p.image.value).toBe('data:image/png;base64,AAA');
    expect(p.updatedAt.value).toBe(5_000);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(capture).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    expect(capture).toHaveBeenCalledTimes(4);
    p.dispose();
  });

  it('does not start while any condition is missing', async () => {
    const { p, capture } = setup();
    p.update({ panelVisible: true, viewActive: true });
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(capture).not.toHaveBeenCalled();
    p.update({ connected: true });
    await flush();
    expect(capture).toHaveBeenCalledTimes(1);
    p.dispose();
  });

  it('pauses when the view is left, the window hidden, the panel closed or the reader gone, and resumes with a fresh screenshot', async () => {
    const { p, capture } = setup();
    p.update(ALL);
    await flush();
    for (const pause of [{ viewActive: false }, { windowVisible: false }, { panelVisible: false }, { connected: false }] as Partial<Conditions>[]) {
      const before = capture.mock.calls.length;
      p.update(pause);
      await vi.advanceTimersByTimeAsync(POLL_MS * 3);
      expect(capture).toHaveBeenCalledTimes(before);
      p.update(ALL);
      await flush();
      expect(capture).toHaveBeenCalledTimes(before + 1);
    }
    p.dispose();
  });

  it('dispose stops the ticking', async () => {
    const { p, capture } = setup();
    p.update(ALL);
    await flush();
    p.dispose();
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(capture).toHaveBeenCalledTimes(1);
  });
});

describe('never overlapping', () => {
  it('skips ticks while a screenshot is still running', async () => {
    let release = (_: string) => {};
    const capture = vi.fn(() => new Promise<string>((r) => { release = r; }));
    const { p } = setup(capture);
    p.update(ALL);
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(p.loading.value).toBe(true);
    release('data:image/png;base64,B');
    await flush();
    expect(p.loading.value).toBe(false);
    expect(p.image.value).toBe('data:image/png;base64,B');
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(capture).toHaveBeenCalledTimes(2);
    p.dispose();
  });

  it('queues exactly one follow-up for refreshes asked for during a running screenshot', async () => {
    const releases: ((s: string) => void)[] = [];
    const capture = vi.fn(() => new Promise<string>((r) => { releases.push(r); }));
    const { p } = setup(capture);
    p.update(ALL);
    p.refresh();
    p.refresh();
    p.refresh();
    expect(capture).toHaveBeenCalledTimes(1);
    releases[0]('a');
    await flush();
    expect(capture).toHaveBeenCalledTimes(2);
    releases[1]('b');
    await flush();
    expect(capture).toHaveBeenCalledTimes(2);
    expect(p.image.value).toBe('b');
    p.dispose();
  });

  it('refresh does nothing while the reader is not connected', async () => {
    const { p, capture } = setup();
    p.update({ panelVisible: true, viewActive: true });
    p.refresh();
    await flush();
    expect(capture).not.toHaveBeenCalled();
  });
});

describe('after a push', () => {
  it('refreshes at once and again once the reader has had time to draw', async () => {
    const { p, capture } = setup();
    p.update(ALL);
    await flush();
    capture.mockClear();
    p.afterPush();
    await flush();
    expect(capture).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(SETTLE_MS - 10);
    expect(capture).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10);
    expect(capture).toHaveBeenCalledTimes(2);
    p.dispose();
  });

  it('coalesces pushes that follow each other', async () => {
    const { p, capture } = setup();
    p.update(ALL);
    await flush();
    capture.mockClear();
    p.afterPush();
    await vi.advanceTimersByTimeAsync(1000);
    p.afterPush();
    await vi.advanceTimersByTimeAsync(SETTLE_MS - 1);
    const settled = capture.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1);
    expect(capture.mock.calls.length).toBe(settled + 1);
    p.dispose();
  });

  it('does nothing when nobody is looking, and drops the pending second refresh when polling pauses', async () => {
    const { p, capture } = setup();
    p.afterPush();
    await flush();
    expect(capture).not.toHaveBeenCalled();

    p.update(ALL);
    await flush();
    capture.mockClear();
    p.afterPush();
    await flush();
    p.update({ panelVisible: false });
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 2);
    expect(capture).toHaveBeenCalledTimes(1);
    p.dispose();
  });
});

describe('a call that never returns', () => {
  it('fails after the timeout, frees the slot and carries on with the next tick', async () => {
    const capture = vi.fn<() => Promise<string>>().mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue('fine');
    const { p, onFailureStreak } = setup(capture, 3_000);
    p.update(ALL);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(p.loading.value).toBe(true);
    expect(capture).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(p.loading.value).toBe(false);
    expect(p.error.value).toMatch(/did not answer/);
    expect(onFailureStreak).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(POLL_MS - 3_000);
    expect(p.image.value).toBe('fine');
    expect(p.error.value).toBe('');
    p.dispose();
  });
});

describe('failures', () => {
  it('keeps the last good image, shows the reason and complains once per streak', async () => {
    const capture = vi.fn<() => Promise<string>>()
      .mockResolvedValueOnce('good')
      .mockRejectedValueOnce('the reader is asleep')
      .mockRejectedValueOnce(new Error('still asleep'))
      .mockResolvedValueOnce('good again')
      .mockRejectedValueOnce('asleep again');
    const { p, onFailureStreak } = setup(capture);
    p.update(ALL);
    await flush();
    expect(p.image.value).toBe('good');
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(p.error.value).toBe('the reader is asleep');
    expect(p.image.value).toBe('good');
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(p.error.value).toBe('still asleep');
    expect(onFailureStreak).toHaveBeenCalledTimes(1);
    expect(onFailureStreak).toHaveBeenCalledWith('the reader is asleep');
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(p.error.value).toBe('');
    expect(p.image.value).toBe('good again');
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(onFailureStreak).toHaveBeenCalledTimes(2);
    p.dispose();
  });
});

describe('dataUrlToBlob', () => {
  it('decodes a base64 data URL into bytes with its type', async () => {
    const blob = dataUrlToBlob(`data:image/png;base64,${btoa(String.fromCharCode(137, 80, 78, 71, 0, 255))}`);
    expect(blob.type).toBe('image/png');
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([137, 80, 78, 71, 0, 255]);
  });

  it('decodes a plain data URL and rejects other strings', async () => {
    expect(await dataUrlToBlob('data:text/plain,a%20b').text()).toBe('a b');
    expect(() => dataUrlToBlob('https://example.com/a.png')).toThrow('Not a data URL');
  });
});
