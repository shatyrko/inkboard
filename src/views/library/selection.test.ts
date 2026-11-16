import { describe, expect, it } from 'vitest';
import { clickSelect, emptySelection, moveSelect, prune, selectAll } from './selection';

const order = ['a', 'b', 'c', 'd', 'e'];
const ids = (s: { ids: ReadonlySet<string> }) => [...s.ids].sort();
const none = { ctrl: false, shift: false };

describe('clickSelect', () => {
  it('selects one row on a plain click', () => {
    const s = clickSelect(clickSelect(emptySelection(), order, 'b', none), order, 'd', none);
    expect(ids(s)).toEqual(['d']);
    expect(s.anchor).toBe('d');
  });
  it('toggles with Ctrl', () => {
    let s = clickSelect(emptySelection(), order, 'a', none);
    s = clickSelect(s, order, 'c', { ctrl: true, shift: false });
    expect(ids(s)).toEqual(['a', 'c']);
    s = clickSelect(s, order, 'a', { ctrl: true, shift: false });
    expect(ids(s)).toEqual(['c']);
  });
  it('selects a range from the anchor with Shift, either direction', () => {
    let s = clickSelect(emptySelection(), order, 'b', none);
    s = clickSelect(s, order, 'd', { ctrl: false, shift: true });
    expect(ids(s)).toEqual(['b', 'c', 'd']);
    s = clickSelect(s, order, 'a', { ctrl: false, shift: true });
    expect(ids(s)).toEqual(['a', 'b']);
    expect(s.anchor).toBe('b');
  });
  it('adds a range to the selection with Ctrl+Shift', () => {
    let s = clickSelect(emptySelection(), order, 'a', none);
    s = clickSelect(s, order, 'c', { ctrl: true, shift: false });
    s = clickSelect(s, order, 'e', { ctrl: true, shift: true });
    expect(ids(s)).toEqual(['a', 'c', 'd', 'e']);
  });
  it('ignores ids that are not in the list', () => {
    const s = clickSelect(emptySelection(), order, 'zzz', none);
    expect(s.ids.size).toBe(0);
  });
});

describe('moveSelect', () => {
  it('starts at the first row going down and at the last going up', () => {
    expect(moveSelect(emptySelection(), order, 1, false).focus).toBe('a');
    expect(moveSelect(emptySelection(), order, -1, false).focus).toBe('e');
  });
  it('moves one row and stops at the ends', () => {
    let s = clickSelect(emptySelection(), order, 'd', none);
    s = moveSelect(s, order, 1, false);
    expect(ids(s)).toEqual(['e']);
    s = moveSelect(s, order, 1, false);
    expect(ids(s)).toEqual(['e']);
  });
  it('jumps to the ends with Home and End', () => {
    const s = clickSelect(emptySelection(), order, 'c', none);
    expect(moveSelect(s, order, -Infinity, false).focus).toBe('a');
    expect(moveSelect(s, order, Infinity, false).focus).toBe('e');
  });
  it('extends the range with Shift', () => {
    let s = clickSelect(emptySelection(), order, 'b', none);
    s = moveSelect(s, order, 1, true);
    s = moveSelect(s, order, 1, true);
    expect(ids(s)).toEqual(['b', 'c', 'd']);
    s = moveSelect(s, order, -3, true);
    expect(ids(s)).toEqual(['a', 'b']);
  });
  it('does nothing on an empty list', () => {
    const s = emptySelection();
    expect(moveSelect(s, [], 1, false)).toBe(s);
  });
});

describe('selectAll and prune', () => {
  it('selects everything', () => {
    expect(ids(selectAll(order))).toEqual(order);
  });
  it('drops rows that disappeared and keeps the rest untouched', () => {
    const s = selectAll(order);
    expect(prune(s, order)).toBe(s);
    const p = prune(s, ['a', 'c']);
    expect(ids(p)).toEqual(['a', 'c']);
    expect(p.focus).toBeNull();
  });
});
