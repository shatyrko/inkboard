// The editor's keyboard shortcuts as data: a key event maps to a command, and the view runs it.
// Kept apart from the view so the mapping is testable and the shortcut list lives in one place.
import type { Order } from './ops';

export type Command =
  | { type: 'nudge'; dx: number; dy: number }
  | { type: 'resize'; dw: number; dh: number }
  | { type: 'order'; how: Order }
  | { type: 'page'; delta: number }
  | { type: 'zoom'; dir: 'in' | 'out' | 'fit' }
  | { type: 'delete' | 'duplicate' | 'copy' | 'cut' | 'paste' | 'undo' | 'redo' | 'deselect' | 'add' | 'grid' | 'publish' | 'export' | 'refresh' | 'newDashboard' | 'newPage' | 'renamePage' };

export type KeyLike = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>;

const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

export function commandForKey(e: KeyLike): Command | null {
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const step = e.shiftKey ? 5 : 1;

  if (mod && !e.altKey) {
    if (k === 'z') return { type: e.shiftKey ? 'redo' : 'undo' };
    if (k === 'y') return { type: 'redo' };
    if (k === 'd') return { type: 'duplicate' };
    if (k === 'c') return { type: 'copy' };
    if (k === 'x') return { type: 'cut' };
    if (k === 'v') return { type: 'paste' };
    if (k === 'p') return { type: 'publish' };
    if (k === 'e' && e.shiftKey) return { type: 'export' };
    if (k === 'n') return { type: 'newDashboard' };
    if (k === 't') return { type: 'newPage' };
    if (k === 'r') return { type: 'refresh' };
    if (k === '0') return { type: 'zoom', dir: 'fit' };
    if (k === '=' || k === '+') return { type: 'zoom', dir: 'in' };
    if (k === '-') return { type: 'zoom', dir: 'out' };
    if (e.code === 'BracketRight') return { type: 'order', how: e.shiftKey ? 'front' : 'forward' };
    if (e.code === 'BracketLeft') return { type: 'order', how: e.shiftKey ? 'back' : 'backward' };
    const a = ARROWS[e.key];
    if (a) return { type: 'resize', dw: a[0] * step, dh: a[1] * step };
    return null;
  }
  if (e.altKey) return null;

  const a = ARROWS[e.key];
  if (a) return { type: 'nudge', dx: a[0] * step, dy: a[1] * step };
  if (e.key === 'Delete' || e.key === 'Backspace') return { type: 'delete' };
  if (e.key === 'Escape') return { type: 'deselect' };
  if (e.key === 'F5') return { type: 'refresh' };
  if (e.key === 'F2') return { type: 'renamePage' };
  if (e.key === 'PageUp') return { type: 'page', delta: -1 };
  if (e.key === 'PageDown') return { type: 'page', delta: 1 };
  if (!e.shiftKey && k === 'a') return { type: 'add' };
  if (!e.shiftKey && k === 'g') return { type: 'grid' };
  return null;
}
