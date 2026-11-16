import { describe, expect, it } from 'vitest';
import { scrollToRow, visibleRange } from './virtual';

const base = { rowH: 40, headH: 32, viewport: 400 };

describe('visibleRange', () => {
  it('renders the first screen plus overscan at the top', () => {
    const r = visibleRange({ ...base, scrollTop: 0, count: 2000, overscan: 2 });
    expect(r.start).toBe(0);
    expect(r.end).toBe(12);
    expect(r.padTop).toBe(0);
    expect(r.padBottom).toBe((2000 - 12) * 40);
  });
  it('keeps total height constant as it scrolls', () => {
    const r = visibleRange({ ...base, scrollTop: 4000, count: 2000, overscan: 2 });
    expect(r.padTop + (r.end - r.start) * 40 + r.padBottom).toBe(2000 * 40);
    expect(r.start).toBeGreaterThan(90);
  });
  it('never exceeds the row count', () => {
    const r = visibleRange({ ...base, scrollTop: 100000, count: 30 });
    expect(r.end).toBe(30);
    expect(r.start).toBeLessThanOrEqual(30);
    expect(r.padBottom).toBe(0);
  });
  it('handles an empty list', () => {
    expect(visibleRange({ ...base, scrollTop: 0, count: 0 })).toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0 });
  });
});

describe('scrollToRow', () => {
  const v = { ...base, scrollTop: 400 };
  it('leaves a visible row alone', () => {
    expect(scrollToRow(12, v)).toBe(400);
  });
  it('scrolls up so the row sits just under the sticky header', () => {
    expect(scrollToRow(3, v)).toBe(120);
    expect(scrollToRow(0, v)).toBe(0);
  });
  it('scrolls down so the row ends at the bottom edge', () => {
    expect(scrollToRow(30, v)).toBe(32 + 30 * 40 + 40 - 400);
  });
});
