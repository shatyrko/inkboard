// The clickable regions of a page, for the PDF's link annotations (Link and Nav widgets).
import type { LinkRect } from '../lib/types';
import { toPixels } from './grid';
import type { Dashboard } from './model';
import { drawOrder } from './render';
import { registry } from './widgets';
import type { AnyWidgetDef } from './widgets/types';

/** Link rectangles of one page in page pixels (origin top-left, targets 1-based), topmost widget first. */
export function pageLinks(dashboard: Dashboard, pageIndex: number): LinkRect[] {
  const page = dashboard.pages[pageIndex];
  if (!page) return [];
  return drawOrder(page.widgets)
    .reverse()
    .flatMap((w) => {
      const def: AnyWidgetDef = registry[w.type];
      return def.links?.({ rect: toPixels(w), props: w.props, pages: dashboard.pages, pageIndex }) ?? [];
    });
}
