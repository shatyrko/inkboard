import { describe, expect, it } from 'vitest';
import { commandForKey, type KeyLike } from './keys';

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key: k, code: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });

describe('commandForKey', () => {
  it('arrows nudge by one cell, Shift by five', () => {
    expect(commandForKey(key('ArrowLeft'))).toEqual({ type: 'nudge', dx: -1, dy: 0 });
    expect(commandForKey(key('ArrowDown', { shiftKey: true }))).toEqual({ type: 'nudge', dx: 0, dy: 5 });
  });

  it('Ctrl and arrows resize', () => {
    expect(commandForKey(key('ArrowRight', { ctrlKey: true }))).toEqual({ type: 'resize', dw: 1, dh: 0 });
    expect(commandForKey(key('ArrowUp', { ctrlKey: true, shiftKey: true }))).toEqual({ type: 'resize', dw: 0, dh: -5 });
  });

  it('maps editing shortcuts', () => {
    expect(commandForKey(key('Delete'))).toEqual({ type: 'delete' });
    expect(commandForKey(key('Backspace'))).toEqual({ type: 'delete' });
    expect(commandForKey(key('d', { ctrlKey: true }))).toEqual({ type: 'duplicate' });
    expect(commandForKey(key('D', { ctrlKey: true }))).toEqual({ type: 'duplicate' });
    expect(commandForKey(key('c', { ctrlKey: true }))).toEqual({ type: 'copy' });
    expect(commandForKey(key('x', { ctrlKey: true }))).toEqual({ type: 'cut' });
    expect(commandForKey(key('v', { metaKey: true }))).toEqual({ type: 'paste' });
    expect(commandForKey(key('Escape'))).toEqual({ type: 'deselect' });
  });

  it('Ctrl+Z undoes, Ctrl+Shift+Z and Ctrl+Y redo', () => {
    expect(commandForKey(key('z', { ctrlKey: true }))).toEqual({ type: 'undo' });
    expect(commandForKey(key('Z', { ctrlKey: true, shiftKey: true }))).toEqual({ type: 'redo' });
    expect(commandForKey(key('y', { ctrlKey: true }))).toEqual({ type: 'redo' });
  });

  it('brackets change the stacking order, with Shift for the ends', () => {
    expect(commandForKey(key(']', { ctrlKey: true, code: 'BracketRight' }))).toEqual({ type: 'order', how: 'forward' });
    expect(commandForKey(key('}', { ctrlKey: true, shiftKey: true, code: 'BracketRight' }))).toEqual({ type: 'order', how: 'front' });
    expect(commandForKey(key('[', { ctrlKey: true, code: 'BracketLeft' }))).toEqual({ type: 'order', how: 'backward' });
    expect(commandForKey(key('{', { ctrlKey: true, shiftKey: true, code: 'BracketLeft' }))).toEqual({ type: 'order', how: 'back' });
  });

  it('maps view and document shortcuts', () => {
    expect(commandForKey(key('a'))).toEqual({ type: 'add' });
    expect(commandForKey(key('g'))).toEqual({ type: 'grid' });
    expect(commandForKey(key('0', { ctrlKey: true }))).toEqual({ type: 'zoom', dir: 'fit' });
    expect(commandForKey(key('=', { ctrlKey: true }))).toEqual({ type: 'zoom', dir: 'in' });
    expect(commandForKey(key('-', { ctrlKey: true }))).toEqual({ type: 'zoom', dir: 'out' });
    expect(commandForKey(key('p', { ctrlKey: true }))).toEqual({ type: 'publish' });
    expect(commandForKey(key('E', { ctrlKey: true, shiftKey: true }))).toEqual({ type: 'export' });
    expect(commandForKey(key('n', { ctrlKey: true }))).toEqual({ type: 'newDashboard' });
    expect(commandForKey(key('t', { ctrlKey: true }))).toEqual({ type: 'newPage' });
    expect(commandForKey(key('F2'))).toEqual({ type: 'renamePage' });
    expect(commandForKey(key('F5'))).toEqual({ type: 'refresh' });
    expect(commandForKey(key('PageDown'))).toEqual({ type: 'page', delta: 1 });
  });

  it('leaves everything else alone', () => {
    expect(commandForKey(key('q'))).toBeNull();
    expect(commandForKey(key('A', { shiftKey: true }))).toBeNull();
    expect(commandForKey(key('ArrowLeft', { altKey: true }))).toBeNull();
    expect(commandForKey(key('w', { ctrlKey: true }))).toBeNull();
  });
});
