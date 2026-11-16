import { describe, expect, it } from 'vitest';
import { failureStreak, shouldPollAdb, shouldRefreshScreen } from './policy';

describe('shouldPollAdb', () => {
  const on = { visible: true, connected: true, connecting: false, windowHidden: false };
  it('polls while the view is shown and the reader is there', () => {
    expect(shouldPollAdb(on)).toBe(true);
  });
  it('does not poll otherwise', () => {
    expect(shouldPollAdb({ ...on, visible: false })).toBe(false);
    expect(shouldPollAdb({ ...on, connected: false })).toBe(false);
    expect(shouldPollAdb({ ...on, connecting: true })).toBe(false);
    expect(shouldPollAdb({ ...on, windowHidden: true })).toBe(false);
  });
});

describe('shouldRefreshScreen', () => {
  const on = { active: true, auto: true, windowHidden: false, windowFocused: true, needsFocus: true, loading: false };
  it('refreshes when switched on, shown and focused', () => {
    expect(shouldRefreshScreen(on)).toBe(true);
  });
  it('waits for focus only when the link needs it', () => {
    expect(shouldRefreshScreen({ ...on, windowFocused: false })).toBe(false);
    expect(shouldRefreshScreen({ ...on, windowFocused: false, needsFocus: false })).toBe(true);
  });
  it('never refreshes a hidden, parked or busy screen, or one switched off', () => {
    expect(shouldRefreshScreen({ ...on, active: false })).toBe(false);
    expect(shouldRefreshScreen({ ...on, auto: false })).toBe(false);
    expect(shouldRefreshScreen({ ...on, windowHidden: true })).toBe(false);
    expect(shouldRefreshScreen({ ...on, loading: true })).toBe(false);
  });
});

describe('failureStreak', () => {
  it('tells about the first failure only', () => {
    let s = failureStreak(0, true);
    expect(s).toEqual({ count: 1, notify: true });
    s = failureStreak(s.count, true);
    expect(s).toEqual({ count: 2, notify: false });
    s = failureStreak(s.count, true);
    expect(s.notify).toBe(false);
  });
  it('starts a new streak after a success', () => {
    expect(failureStreak(5, false)).toEqual({ count: 0, notify: false });
    expect(failureStreak(failureStreak(5, false).count, true).notify).toBe(true);
  });
});
