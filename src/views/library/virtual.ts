// Windowing for the file table: rows have a fixed height, so the visible slice follows from the scroll position alone.

export type RangeInput = { scrollTop: number; viewport: number; rowH: number; headH: number; count: number; overscan?: number };

/** the slice of rows to render and the spacer heights that keep the scrollbar honest */
export function visibleRange({ scrollTop, viewport, rowH, headH, count, overscan = 8 }: RangeInput) {
  const first = Math.floor((scrollTop - headH) / rowH);
  const last = Math.ceil((scrollTop + viewport - headH) / rowH);
  const start = Math.max(0, Math.min(count, first - overscan));
  const end = Math.max(start, Math.min(count, last + overscan));
  return { start, end, padTop: start * rowH, padBottom: (count - end) * rowH };
}

/** the new scrollTop that brings row `index` fully into view below the sticky header (unchanged when it already is) */
export function scrollToRow(index: number, { scrollTop, viewport, rowH, headH }: Omit<RangeInput, 'count' | 'overscan'>): number {
  const top = headH + index * rowH;
  if (top < scrollTop + headH) return Math.max(0, top - headH);
  if (top + rowH > scrollTop + viewport) return top + rowH - viewport;
  return scrollTop;
}
