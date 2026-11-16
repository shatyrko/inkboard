import { describe, expect, it } from 'vitest';
import { createWidget, newDashboard, newPage, type Dashboard } from './model';
import { gridOf } from './grid';
import * as ops from './ops';
import { drawOrder } from './render';

const bounds = gridOf('portrait');
const box = (x = 1, y = 1) => createWidget('box', bounds, { x, y });

function fixture(): { d: Dashboard; pageId: string; ids: string[] } {
  const d = newDashboard('T', [newPage('One'), newPage('Two')]);
  let cur = d;
  const pageId = d.pages[0].id;
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const w = box(i * 4, 0);
    ids.push(w.id);
    cur = ops.addWidget(cur, pageId, w);
  }
  return { d: cur, pageId, ids };
}

describe('widgets', () => {
  it('adds a widget on top', () => {
    const { d, pageId, ids } = fixture();
    expect(drawOrder(d.pages[0].widgets).map((w) => w.id)).toEqual(ids);
    expect(d.pages[0].widgets.map((w) => w.z)).toEqual([0, 1, 2]);
    expect(pageId).toBe(d.pages[0].id);
  });

  it('shares everything it did not change', () => {
    const { d, pageId, ids } = fixture();
    const next = ops.setRect(d, pageId, ids[1], { x: 9, y: 9, w: 3, h: 3 });
    expect(next.pages[1]).toBe(d.pages[1]);
    expect(next.pages[0].widgets[0]).toBe(d.pages[0].widgets[0]);
    expect(next.pages[0].widgets[1]).not.toBe(d.pages[0].widgets[1]);
  });

  it('returns the same document when nothing changes', () => {
    const { d, pageId, ids } = fixture();
    const w = d.pages[0].widgets[0];
    expect(ops.setRect(d, pageId, ids[0], { x: w.x, y: w.y, w: w.w, h: w.h })).toBe(d);
    expect(ops.removeWidget(d, pageId, 'missing')).toBe(d);
    expect(ops.reorder(d, pageId, ids[2], 'front')).toBe(d);
  });

  it('clamps a new rectangle to the page and the widget minimum', () => {
    const { d, pageId, ids } = fixture();
    const next = ops.setRect(d, pageId, ids[0], { x: 99, y: 99, w: 0, h: 0 });
    expect(next.pages[0].widgets[0]).toMatchObject({ x: 32, y: 43, w: 1, h: 1 });
  });

  it('patches props without touching the rest', () => {
    const { d, pageId, ids } = fixture();
    const next = ops.patchProps<'box'>(d, pageId, ids[0], { stroke: 12 });
    const w = next.pages[0].widgets[0];
    expect(w.type === 'box' && w.props).toMatchObject({ stroke: 12, shape: 'rounded' });
  });

  it('removes a widget', () => {
    const { d, pageId, ids } = fixture();
    expect(ops.removeWidget(d, pageId, ids[1]).pages[0].widgets.map((w) => w.id)).toEqual([ids[0], ids[2]]);
  });

  it('clones with a new id, an offset kept on the page, and on top', () => {
    const { d, pageId } = fixture();
    const src = createWidget('box', bounds, { x: 31, y: 43, w: 2, h: 1 });
    const copy = ops.cloneWidget(d, pageId, src);
    expect(copy.id).not.toBe(src.id);
    expect(copy.x + copy.w).toBeLessThanOrEqual(33);
    expect(copy.y + copy.h).toBeLessThanOrEqual(44);
    expect(copy.z).toBe(3);
  });

  it('finds the topmost widget at a point', () => {
    const { d, pageId, ids } = fixture();
    const over = ops.addWidget(d, pageId, createWidget('box', bounds, { x: 0, y: 0, w: 6, h: 3 }));
    const top = over.pages[0].widgets[3].id;
    expect(ops.widgetAt(over.pages[0], 1, 1)?.id).toBe(top);
    expect(ops.widgetAt(over.pages[0], 9, 1)?.id).toBe(ids[2]);
    expect(ops.widgetAt(over.pages[0], 30, 30)).toBeUndefined();
  });
});

describe('reorder', () => {
  it('moves one step or to either end and renumbers z', () => {
    const { d, pageId, ids } = fixture();
    const order = (x: Dashboard) => drawOrder(x.pages[0].widgets).map((w) => w.id);
    expect(order(ops.reorder(d, pageId, ids[0], 'forward'))).toEqual([ids[1], ids[0], ids[2]]);
    expect(order(ops.reorder(d, pageId, ids[2], 'backward'))).toEqual([ids[0], ids[2], ids[1]]);
    expect(order(ops.reorder(d, pageId, ids[0], 'front'))).toEqual([ids[1], ids[2], ids[0]]);
    expect(order(ops.reorder(d, pageId, ids[2], 'back'))).toEqual([ids[2], ids[0], ids[1]]);
    expect(ops.reorder(d, pageId, ids[0], 'front').pages[0].widgets.map((w) => w.z).sort()).toEqual([0, 1, 2]);
  });
});

describe('pages', () => {
  it('adds, renames, moves and removes pages', () => {
    const { d } = fixture();
    const added = ops.addPage(d);
    expect(added.pages.map((p) => p.name)).toEqual(['One', 'Two', 'Page 3']);
    const id = added.pages[2].id;
    expect(ops.movePage(added, id, -1).pages.map((p) => p.name)).toEqual(['One', 'Page 3', 'Two']);
    expect(ops.movePage(added, id, -9).pages[0].id).toBe(id);
    expect(ops.movePage(added, id, 5)).toBe(added);
    expect(ops.renamePage(added, id, 'Notes').pages[2].name).toBe('Notes');
    expect(ops.removePage(added, id).pages).toHaveLength(2);
  });

  it('keeps the last page', () => {
    const one = newDashboard('T');
    expect(ops.removePage(one, one.pages[0].id)).toBe(one);
  });

  it('duplicates a page with fresh widget ids, right after the original', () => {
    const { d } = fixture();
    const next = ops.duplicatePage(d, d.pages[0].id);
    expect(next.pages.map((p) => p.name)).toEqual(['One', 'One copy', 'Two']);
    const ids = new Set(next.pages.flatMap((p) => p.widgets.map((w) => w.id)));
    expect(ids.size).toBe(6);
  });
});

describe('setOrientation', () => {
  it('re-clamps widgets onto the other grid', () => {
    let d = newDashboard('T');
    d = ops.addWidget(d, d.pages[0].id, createWidget('box', bounds, { x: 1, y: 30, w: 30, h: 10 }));
    const land = ops.setOrientation(d, 'landscape');
    const w = land.pages[0].widgets[0];
    expect(land.orientation).toBe('landscape');
    expect(w.y + w.h).toBeLessThanOrEqual(33);
    expect(w.x + w.w).toBeLessThanOrEqual(44);
    expect(ops.setOrientation(land, 'landscape')).toBe(land);
  });
});
