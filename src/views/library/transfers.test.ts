import { describe, expect, it } from 'vitest';
import type { TransferProgress } from '../../lib/types';
import { describeTransfer, percent, removeTransfer, upsertTransfer } from './transfers';

const t = (over: Partial<TransferProgress> = {}): TransferProgress => ({ id: 'a', name: 'x.pdf', direction: 'up', sent: 0, total: 1000, done: false, error: null, ...over });

describe('transfer list', () => {
  it('appends a new transfer and replaces a known one in place', () => {
    let list = upsertTransfer([], t());
    list = upsertTransfer(list, t({ id: 'b', name: 'y.pdf' }));
    list = upsertTransfer(list, t({ sent: 500 }));
    expect(list.map((x) => x.id)).toEqual(['a', 'b']);
    expect(list[0].sent).toBe(500);
  });
  it('removes by id', () => {
    expect(removeTransfer([t(), t({ id: 'b' })], 'a').map((x) => x.id)).toEqual(['b']);
  });
});

describe('progress text', () => {
  it('gives a percentage clamped to 0-100', () => {
    expect(percent(t({ sent: 250 }))).toBe(25);
    expect(percent(t({ sent: 5000 }))).toBe(100);
    expect(percent(t({ total: 0 }))).toBe(0);
    expect(percent(t({ done: true, sent: 1000 }))).toBe(100);
  });
  it('does not show a failed transfer as complete', () => {
    expect(percent(t({ done: true, sent: 100, error: 'No space left' }))).toBe(10);
  });
  it('describes bytes, completion and errors', () => {
    expect(describeTransfer(t({ sent: 1_500_000, total: 12_000_000 }))).toBe('1.5 MB of 12.0 MB');
    expect(describeTransfer(t({ done: true, total: 3_000_000 }))).toBe('Done, 3.0 MB');
    expect(describeTransfer(t({ done: true, error: 'The reader is full' }))).toBe('The reader is full');
  });
});
