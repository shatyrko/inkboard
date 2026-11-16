// Grid and geometry math shared by the renderer (pixels) and the editor (cells). Pure, no DOM.
// A page is a snap grid of 50 px cells: 33 x 44 cells = 1650 x 2200 px (the reader's portrait screen at ~150 dpi).

export type Orientation = 'portrait' | 'landscape';
export type Rect = { x: number; y: number; w: number; h: number };
export type Bounds = { cols: number; rows: number };
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

export const CELL = 50;
export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export function gridOf(o: Orientation): Bounds {
  return o === 'landscape' ? { cols: 44, rows: 33 } : { cols: 33, rows: 44 };
}

export function pageSize(o: Orientation): { width: number; height: number } {
  const g = gridOf(o);
  return { width: g.cols * CELL, height: g.rows * CELL };
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** a cell rectangle in page pixels */
export function toPixels(r: Rect): Rect {
  return { x: r.x * CELL, y: r.y * CELL, w: r.w * CELL, h: r.h * CELL };
}

/** nearest cell index for a pixel offset */
export const snapToCell = (px: number) => Math.round(px / CELL);

/** keeps a rectangle on the page and at least `min` cells big */
export function clampRect(r: Rect, b: Bounds, min = { w: 1, h: 1 }): Rect {
  const w = clamp(Math.round(r.w), min.w, b.cols);
  const h = clamp(Math.round(r.h), min.h, b.rows);
  return { x: clamp(Math.round(r.x), 0, b.cols - w), y: clamp(Math.round(r.y), 0, b.rows - h), w, h };
}

export function moveRect(r: Rect, dx: number, dy: number, b: Bounds): Rect {
  return { ...r, x: clamp(r.x + dx, 0, b.cols - r.w), y: clamp(r.y + dy, 0, b.rows - r.h) };
}

/** drags one handle by (dx, dy) cells; an edge never crosses the opposite one or leaves the page */
export function resizeRect(r: Rect, handle: Handle, dx: number, dy: number, min: { w: number; h: number }, b: Bounds): Rect {
  let left = r.x, top = r.y, right = r.x + r.w, bottom = r.y + r.h;
  if (handle.includes('w')) left = clamp(left + dx, 0, right - min.w);
  if (handle.includes('e')) right = clamp(right + dx, left + min.w, b.cols);
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - min.h);
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + min.h, b.rows);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

export const rectContains = (r: Rect, px: number, py: number) => px >= r.x && py >= r.y && px < r.x + r.w && py < r.y + r.h;

/** Fits a page of `page` px into a box, leaving `pad` px around it; never upscales beyond `max`. */
export function fitScale(page: { width: number; height: number }, box: { width: number; height: number }, pad = 0, max = 1): number {
  const s = Math.min((box.width - pad * 2) / page.width, (box.height - pad * 2) / page.height);
  return clamp(Number.isFinite(s) ? s : 0.1, 0.05, max);
}
