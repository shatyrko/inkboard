import { describe, expect, it } from 'vitest';
import { gridOf } from './grid';
import { coerceProps, createWidget, migrateDashboard, newDashboard } from './model';
import { SAMPLES } from './samples';

describe('migrateDashboard', () => {
  it('turns nothing at all into a valid one-page dashboard', () => {
    for (const raw of [null, undefined, 42, 'x', [], {}]) {
      const d = migrateDashboard(raw, 'fallback');
      expect(d.id).toBe('fallback');
      expect(d.name).toBe('Untitled dashboard');
      expect(d.orientation).toBe('portrait');
      expect(d.pages).toHaveLength(1);
      expect(d.pages[0].widgets).toEqual([]);
    }
  });

  it('keeps a sound document as it is, adding only the default target', () => {
    const d = SAMPLES.find((s) => s.id === 'daily')!.make('Daily');
    const loaded = migrateDashboard(JSON.parse(JSON.stringify(d)));
    expect(loaded).toEqual({ ...d, publish: { target: { kind: 'dpt' } } });
    expect(migrateDashboard(JSON.parse(JSON.stringify(loaded)))).toEqual(loaded);
  });

  it('drops unknown widget types and widgets that are not objects', () => {
    const d = migrateDashboard({ id: 'a', name: 'A', pages: [{ id: 'p', widgets: [{ type: 'hologram', x: 1, y: 1, w: 2, h: 2 }, 7, null, { type: 'text', x: 1, y: 1, w: 4, h: 2 }] }] });
    expect(d.pages[0].widgets.map((w) => w.type)).toEqual(['text']);
  });

  it('clamps geometry onto the grid and fills missing sizes from the widget defaults', () => {
    const d = migrateDashboard({ pages: [{ widgets: [{ type: 'text', x: 99, y: -5, w: 500, h: 0 }, { type: 'clock', x: 'left', y: 2 }] }] });
    const [a, b] = d.pages[0].widgets;
    expect(a).toMatchObject({ x: 0, y: 0, w: 33, h: 1 });
    expect(b.w).toBeGreaterThan(1);
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.w).toBeLessThanOrEqual(33);
  });

  it('uses the landscape grid when the document says so', () => {
    const d = migrateDashboard({ orientation: 'landscape', pages: [{ widgets: [{ type: 'box', x: 40, y: 30, w: 4, h: 3 }] }] });
    expect(d.orientation).toBe('landscape');
    expect(d.pages[0].widgets[0]).toMatchObject({ x: 40, y: 30 });
  });

  it('makes page and widget ids unique and fills missing ones', () => {
    const d = migrateDashboard({
      pages: [
        { id: 'same', widgets: [{ id: 'w', type: 'box' }, { id: 'w', type: 'box' }, { type: 'box' }] },
        { id: 'same', widgets: [] },
      ],
    });
    expect(new Set(d.pages.map((p) => p.id)).size).toBe(2);
    expect(new Set(d.pages[0].widgets.map((w) => w.id)).size).toBe(3);
  });

  it('repairs props of the wrong type and keeps good ones', () => {
    const d = migrateDashboard({ pages: [{ widgets: [{ type: 'text', props: { text: 12, size: 'big', align: 'right', extra: true } }] }] });
    const w = d.pages[0].widgets[0];
    expect(w.type === 'text' && w.props).toMatchObject({ text: expect.stringContaining('Notes'), size: 36, align: 'right' });
    expect(w.props).not.toHaveProperty('extra');
  });

  it('range-clamps numbers and cleans checklist items', () => {
    const d = migrateDashboard({ pages: [{ widgets: [
      { type: 'text', props: { size: 5000 } },
      { type: 'checklist', props: { items: [{ text: 'ok', done: true }, { done: true }, 'x', null, { id: 'i', text: 'two' }] } },
    ] }] });
    const [t, c] = d.pages[0].widgets;
    expect(t.type === 'text' && t.props.size).toBe(300);
    expect(c.type === 'checklist' && c.props.items.map((i) => [i.text, i.done])).toEqual([['ok', true], ['two', false]]);
  });

  it('normalises schedule and publish options', () => {
    const d = migrateDashboard({ schedule: { enabled: true, everyMinutes: 0 }, publish: { folder: '  Document/Mine ', display: false } });
    expect(d.schedule).toEqual({ enabled: true, everyMinutes: 1 });
    expect(d.publish).toEqual({ folder: 'Document/Mine', display: false, target: { kind: 'dpt' } });
    const e = migrateDashboard({ schedule: { enabled: 'yes' }, publish: { folder: ' ', display: 3 } });
    expect(e.schedule).toEqual({ enabled: false, everyMinutes: 30 });
    expect(e.publish).toEqual({ target: { kind: 'dpt' } });
  });

  it('sends documents from before USB readers to the Digital Paper', () => {
    expect(migrateDashboard({ id: 'a', name: 'A', pages: [] }).publish).toEqual({ target: { kind: 'dpt' } });
    expect(migrateDashboard({ publish: { folder: 'Document/Old' } }).publish).toEqual({ folder: 'Document/Old', target: { kind: 'dpt' } });
  });

  it('keeps a USB target with its reader, folder and format and the remembered name', () => {
    const d = migrateDashboard({ publish: { target: { kind: 'mtp', readerId: 'mtp:ab12', folder: ' Documents/Wall ', format: 'png' }, targetName: ' Tab X C ' } });
    expect(d.publish).toEqual({ target: { kind: 'mtp', readerId: 'mtp:ab12', folder: 'Documents/Wall', format: 'png' }, targetName: 'Tab X C' });
  });

  it('keeps a valid resolution choice and drops anything else', () => {
    expect(migrateDashboard({ publish: { resolution: 'standard' } }).publish?.resolution).toBe('standard');
    expect(migrateDashboard({ publish: { resolution: 'native' } }).publish?.resolution).toBe('native');
    expect(migrateDashboard({ publish: { resolution: 'huge' } }).publish).toEqual({ target: { kind: 'dpt' } });
    expect(migrateDashboard({}).publish?.resolution).toBeUndefined();
  });

  it('keeps the pen template format', () => {
    expect(migrateDashboard({ publish: { target: { kind: 'mtp', readerId: 'mtp:x', format: 'template' } } }).publish?.target).toEqual({ kind: 'mtp', readerId: 'mtp:x', folder: '', format: 'template' });
  });

  it('repairs a broken USB target: unknown formats become PDF, targets without a reader become the Digital Paper', () => {
    expect(migrateDashboard({ publish: { target: { kind: 'mtp', readerId: 'mtp:x', format: 'gif', folder: 7 } } }).publish?.target).toEqual({ kind: 'mtp', readerId: 'mtp:x', folder: '', format: 'pdf' });
    for (const target of [{ kind: 'mtp' }, { kind: 'mtp', readerId: '' }, { kind: 'floppy' }, 'mtp', null, 5]) {
      expect(migrateDashboard({ publish: { target } }).publish?.target).toEqual({ kind: 'dpt' });
    }
  });

  it('replaces a broken timestamp', () => {
    expect(Date.parse(migrateDashboard({ updated: 'yesterday' }).updated)).not.toBeNaN();
  });
});

describe('createWidget', () => {
  it('gives every type a default size that fits the page', () => {
    for (const type of ['text', 'clock', 'calendar', 'checklist', 'countdown', 'image', 'system', 'reader', 'web', 'command', 'box', 'link', 'nav'] as const) {
      const w = createWidget(type, gridOf('portrait'), { x: 30, y: 43 });
      expect(w.x + w.w).toBeLessThanOrEqual(33);
      expect(w.y + w.h).toBeLessThanOrEqual(44);
      expect(w.type).toBe(type);
    }
  });

  it('honours an explicit size and merges props over the defaults', () => {
    const w = createWidget('text', gridOf('portrait'), { x: 2, y: 3, w: 5, h: 4 }, { size: 50 });
    expect(w).toMatchObject({ x: 2, y: 3, w: 5, h: 4, props: { size: 50, align: 'left' } });
  });
});

describe('coerceProps', () => {
  it('keeps only known keys with the right type', () => {
    expect(coerceProps({ a: 1, b: 'x', c: true, d: [1] }, { a: '2', b: 'y', c: false, d: 5, z: 1 })).toEqual({ a: 1, b: 'y', c: false, d: [1] });
  });
});

describe('newDashboard', () => {
  it('starts with one empty page', () => {
    const d = newDashboard('Mine');
    expect(d.pages).toHaveLength(1);
    expect(d.version).toBe(1);
  });
});
