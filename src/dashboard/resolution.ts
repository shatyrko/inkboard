// Picture resolution for USB readers: pages are drawn at the reader's own screen size instead of the standard 1650 x 2200,
// by scaling the drawing (not a bitmap), so text and lines stay crisp. PDFs and the Digital Paper always use the standard size.
import type { PublishTarget } from '../lib/types';
import { pageSize } from './grid';
import type { Dashboard } from './model';
import { targetOf } from './publish-target';

export type Size = { width: number; height: number };
export type RenderSize = Size & { scale: number };

/** the highest factor a page is scaled by: beyond this a file only gets bigger, and 2 x 2200 x 1650 x ... must fit in memory */
export const MAX_SCALE = 2;
/** how far the screen's shape may be from the page's before the page would have to be stretched */
export const ASPECT_TOLERANCE = 0.01;

/** pictures (not PDFs) saved to a USB reader */
export const usesPictures = (t: PublishTarget): boolean => t.kind === 'mtp' && t.format !== 'pdf';

/**
 * The size that fills the reader's screen with `page`, or null when there is no screen size or its shape does not match
 * (within 1 %, held either way up). Screens that would need more than twice the standard size are rendered at twice.
 */
export function nativeSize(page: Size, screen: Size | null | undefined): RenderSize | null {
  if (!screen || screen.width <= 0 || screen.height <= 0) return null;
  const sameWayUp = (page.width >= page.height) === (screen.width >= screen.height);
  const shown = sameWayUp ? screen : { width: screen.height, height: screen.width };
  if (Math.abs(shown.width / shown.height / (page.width / page.height) - 1) > ASPECT_TOLERANCE) return null;
  const scale = shown.width / page.width;
  if (scale > MAX_SCALE) return { width: Math.round(page.width * MAX_SCALE), height: Math.round(page.height * MAX_SCALE), scale: MAX_SCALE };
  return { width: shown.width, height: shown.height, scale };
}

/** the native size when it differs from the standard one, and only for pictures: what the "Resolution" control offers */
export function offeredNativeSize(d: Dashboard, screen: Size | null | undefined): RenderSize | null {
  if (!usesPictures(targetOf(d))) return null;
  const standard = pageSize(d.orientation);
  const native = nativeSize(standard, screen);
  return native && native.width !== standard.width ? native : null;
}

/** the size to render `d` at: native when it is offered and not switched off, the standard page otherwise */
export function renderSizeFor(d: Dashboard, screen: Size | null | undefined): RenderSize {
  const native = d.publish?.resolution === 'standard' ? null : offeredNativeSize(d, screen);
  return native ?? { ...pageSize(d.orientation), scale: 1 };
}

/** the two choices of the "Resolution" control, or null when there is nothing to choose */
export function resolutionOptions(d: Dashboard, screen: Size | null | undefined): { value: 'native' | 'standard'; label: string }[] | null {
  const native = offeredNativeSize(d, screen);
  if (!native) return null;
  const std = pageSize(d.orientation);
  return [
    { value: 'native', label: `Match the reader (${native.width} x ${native.height})` },
    { value: 'standard', label: `Standard (${std.width} x ${std.height})` },
  ];
}
