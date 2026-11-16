// When to talk to a USB reader: pure decisions, so the timers in the views stay one-liners and the rules can be tested.

/** The status poll never prompts the reader, so it is cheap, but it still only runs while the view is shown and nothing else is going on. */
export function shouldPollAdb(s: { visible: boolean; connected: boolean; connecting: boolean; windowHidden: boolean }): boolean {
  return s.visible && s.connected && !s.connecting && !s.windowHidden;
}

/** The live screen refreshes by itself only when switched on, while its view is shown, and (for a heavier link) the window has focus. */
export function shouldRefreshScreen(s: { active: boolean; auto: boolean; windowHidden: boolean; windowFocused: boolean; needsFocus: boolean; loading: boolean }): boolean {
  if (!s.active || !s.auto || s.windowHidden || s.loading) return false;
  return !s.needsFocus || s.windowFocused;
}

/** One toast for the first failure of a streak, silence until a request works again. */
export function failureStreak(count: number, failed: boolean): { count: number; notify: boolean } {
  return failed ? { count: count + 1, notify: count === 0 } : { count: 0, notify: false };
}
