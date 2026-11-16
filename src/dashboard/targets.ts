// Page-to-page navigation shared by the Link and Nav widgets and the PDF link generation. Pure.
import type { Page } from './model';

/**
 * The page index a link points to, or null when there is nowhere to go (a deleted page, or "next" on a one-page dashboard).
 * "next" and "prev" wrap around, which suits a dashboard that is flipped through on the reader.
 */
export function resolveTarget(target: string, pages: Page[], current: number): number | null {
  const n = pages.length;
  switch (target) {
    case 'next': return n > 1 ? (current + 1) % n : null;
    case 'prev': return n > 1 ? (current - 1 + n) % n : null;
    case 'first': return n ? 0 : null;
    case 'last': return n ? n - 1 : null;
    default: {
      const i = pages.findIndex((p) => p.id === target);
      return i >= 0 ? i : null;
    }
  }
}

/** The cells of the page strip: side by side in a wide widget, stacked in a tall one. Local coordinates, whole pixels. */
export function navCells(w: number, h: number, count: number): { x: number; y: number; w: number; h: number }[] {
  const horizontal = w >= h;
  return Array.from({ length: count }, (_, i) => {
    const a = Math.round((i * (horizontal ? w : h)) / count);
    const b = Math.round(((i + 1) * (horizontal ? w : h)) / count);
    return horizontal ? { x: a, y: 0, w: b - a, h } : { x: 0, y: a, w, h: b - a };
  });
}
