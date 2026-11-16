import { describe, expect, it } from 'vitest';
import { gridOf } from './grid';
import { pageLinks } from './links';
import { createWidget, newDashboard, newPage } from './model';
import { navCells, resolveTarget } from './targets';

const bounds = gridOf('portrait');
const dashboard = () => newDashboard('T', [newPage('A'), newPage('B'), newPage('C')]);

describe('resolveTarget', () => {
  const pages = [newPage('A'), newPage('B'), newPage('C')];

  it('resolves the relative targets, wrapping around', () => {
    expect(resolveTarget('next', pages, 0)).toBe(1);
    expect(resolveTarget('next', pages, 2)).toBe(0);
    expect(resolveTarget('prev', pages, 0)).toBe(2);
    expect(resolveTarget('first', pages, 1)).toBe(0);
    expect(resolveTarget('last', pages, 1)).toBe(2);
  });

  it('resolves a page id, and gives null for a deleted page or a lone page', () => {
    expect(resolveTarget(pages[1].id, pages, 0)).toBe(1);
    expect(resolveTarget('gone', pages, 0)).toBeNull();
    expect(resolveTarget('next', [pages[0]], 0)).toBeNull();
  });
});

describe('navCells', () => {
  it('lays a wide strip out in a row that covers the widget exactly', () => {
    const cells = navCells(100, 20, 3);
    expect(cells).toEqual([{ x: 0, y: 0, w: 33, h: 20 }, { x: 33, y: 0, w: 34, h: 20 }, { x: 67, y: 0, w: 33, h: 20 }]);
  });

  it('stacks cells in a tall widget', () => {
    expect(navCells(20, 90, 3).map((c) => [c.y, c.h])).toEqual([[0, 30], [30, 30], [60, 30]]);
  });
});

describe('pageLinks', () => {
  it('turns a Link widget into a rectangle in page pixels with a 1-based target', () => {
    const d = dashboard();
    d.pages[0].widgets.push(createWidget('link', bounds, { x: 2, y: 3, w: 9, h: 3 }, { target: d.pages[2].id }));
    expect(pageLinks(d, 0)).toEqual([{ x: 100, y: 150, w: 450, h: 150, page: 3 }]);
  });

  it('turns a Nav widget into one rectangle per page', () => {
    const d = dashboard();
    d.pages[1].widgets.push(createWidget('nav', bounds, { x: 1, y: 42, w: 30, h: 2 }));
    const links = pageLinks(d, 1);
    expect(links.map((l) => l.page)).toEqual([1, 2, 3]);
    expect(links[0]).toEqual({ x: 50, y: 2100, w: 500, h: 100, page: 1 });
    expect(links[2]).toEqual({ x: 1050, y: 2100, w: 500, h: 100, page: 3 });
    expect(links.reduce((sum, l) => sum + l.w, 0)).toBe(1500);
  });

  it('follows page order when a page is the target "next" and skips dead links', () => {
    const d = dashboard();
    d.pages[2].widgets.push(createWidget('link', bounds, { x: 0, y: 0 }, { target: 'next' }));
    d.pages[0].widgets.push(createWidget('link', bounds, { x: 0, y: 0 }, { target: 'missing-page' }));
    expect(pageLinks(d, 2)[0].page).toBe(1);
    expect(pageLinks(d, 0)).toEqual([]);
  });

  it('lists the topmost widget first and ignores widgets without links', () => {
    const d = dashboard();
    const low = createWidget('link', bounds, { x: 0, y: 0 }, { target: 'first' }, 0);
    const high = createWidget('link', bounds, { x: 0, y: 0 }, { target: 'last' }, 5);
    d.pages[1].widgets.push(low, createWidget('text', bounds), high);
    expect(pageLinks(d, 1).map((l) => l.page)).toEqual([3, 1]);
  });

  it('is empty for a page that does not exist', () => {
    expect(pageLinks(dashboard(), 9)).toEqual([]);
  });
});
