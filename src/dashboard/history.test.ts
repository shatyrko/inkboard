import { describe, expect, it } from 'vitest';
import { History } from './history';

describe('History', () => {
  it('undoes and redoes in order', () => {
    const h = new History('a');
    h.push('b');
    h.push('c');
    expect(h.undo()).toBe(true);
    expect(h.present).toBe('b');
    expect(h.undo()).toBe(true);
    expect(h.present).toBe('a');
    expect(h.undo()).toBe(false);
    expect(h.redo()).toBe(true);
    expect(h.present).toBe('b');
    expect(h.canRedo).toBe(true);
  });

  it('drops the redo branch on a new change', () => {
    const h = new History('a');
    h.push('b');
    h.undo();
    h.push('c');
    expect(h.canRedo).toBe(false);
    expect(h.redo()).toBe(false);
  });

  it('ignores a push of the same state', () => {
    const h = new History('a');
    h.push('a');
    expect(h.canUndo).toBe(false);
  });

  it('is bounded: the oldest states fall off', () => {
    const h = new History(0, 3);
    for (let i = 1; i <= 10; i++) h.push(i);
    let steps = 0;
    while (h.undo()) steps++;
    expect(steps).toBe(3);
    expect(h.present).toBe(7);
  });

  it('merges quick edits with the same key into one step', () => {
    let t = 1000;
    const h = new History('', 100, () => t);
    h.push('h', 'text');
    t += 100;
    h.push('he', 'text');
    t += 100;
    h.push('hel', 'text');
    h.undo();
    expect(h.present).toBe('');
    expect(h.canUndo).toBe(false);
  });

  it('starts a new step after a pause or with another key', () => {
    let t = 0;
    const h = new History('', 100, () => t);
    h.push('a', 'k');
    t += 5000;
    h.push('ab', 'k');
    h.push('abc', 'other');
    h.undo();
    expect(h.present).toBe('ab');
    h.undo();
    expect(h.present).toBe('a');
  });

  it('records a gesture as one step', () => {
    const h = new History(0);
    h.live(1);
    h.live(2);
    h.live(3);
    expect(h.present).toBe(3);
    expect(h.settle()).toBe(true);
    h.undo();
    expect(h.present).toBe(0);
    expect(h.canUndo).toBe(false);
  });

  it('records nothing for a gesture that ends where it began', () => {
    const h = new History(5);
    h.live(6);
    h.live(5);
    expect(h.settle()).toBe(false);
    expect(h.canUndo).toBe(false);
  });

  it('can abort a gesture back to its start', () => {
    const h = new History(5);
    h.live(9);
    h.abort();
    expect(h.present).toBe(5);
    expect(h.canUndo).toBe(false);
  });

  it('undo during a gesture first settles it', () => {
    const h = new History(0);
    h.live(1);
    h.undo();
    expect(h.present).toBe(0);
  });
});
