// Edits to a dashboard as pure functions: each returns a new document and shares everything it did not touch,
// which is what lets the undo history keep cheap snapshots. Nothing here knows about Vue, the DOM or the API.
import { clamp, clampRect, gridOf, rectContains, type Rect } from './grid';
import { newId } from './ids';
import { drawOrder } from './render';
import { registry } from './widgets';
import type { Dashboard, Orientation, Page, Widget, WidgetProps, WidgetType } from './model';

export type Order = 'front' | 'back' | 'forward' | 'backward';

const minSize = (w: Widget) => ({ w: registry[w.type].size.minW, h: registry[w.type].size.minH });

function mapPage(d: Dashboard, pageId: string, fn: (p: Page) => Page): Dashboard {
  let changed = false;
  const pages = d.pages.map((p) => {
    if (p.id !== pageId) return p;
    const next = fn(p);
    changed = next !== p;
    return next;
  });
  return changed ? { ...d, pages } : d;
}

function mapWidget(d: Dashboard, pageId: string, id: string, fn: (w: Widget) => Widget): Dashboard {
  return mapPage(d, pageId, (p) => {
    let changed = false;
    const widgets = p.widgets.map((w) => {
      if (w.id !== id) return w;
      const next = fn(w);
      changed = next !== w;
      return next;
    });
    return changed ? { ...p, widgets } : p;
  });
}

/** the topmost widget under a point given in cells (fractions allowed) */
export function widgetAt(page: Page, cx: number, cy: number): Widget | undefined {
  return drawOrder(page.widgets).reverse().find((w) => rectContains(w, cx, cy));
}

const topZ = (widgets: Widget[]) => widgets.reduce((m, w) => Math.max(m, w.z ?? 0), -1) + 1;

/** puts `widget` on top of the page's other widgets */
export function addWidget(d: Dashboard, pageId: string, widget: Widget): Dashboard {
  return mapPage(d, pageId, (p) => ({ ...p, widgets: [...p.widgets, { ...widget, z: topZ(p.widgets) }] }));
}

export function setRect(d: Dashboard, pageId: string, id: string, rect: Rect): Dashboard {
  const bounds = gridOf(d.orientation);
  return mapWidget(d, pageId, id, (w) => {
    const r = clampRect(rect, bounds, minSize(w));
    return r.x === w.x && r.y === w.y && r.w === w.w && r.h === w.h ? w : { ...w, ...r };
  });
}

export function patchProps<T extends WidgetType>(d: Dashboard, pageId: string, id: string, patch: Partial<WidgetProps[T]>): Dashboard {
  return mapWidget(d, pageId, id, (w) => ({ ...w, props: { ...w.props, ...patch } }) as Widget);
}

export function removeWidget(d: Dashboard, pageId: string, id: string): Dashboard {
  return mapPage(d, pageId, (p) => (p.widgets.some((w) => w.id === id) ? { ...p, widgets: p.widgets.filter((w) => w.id !== id) } : p));
}

/** a copy with a fresh id, on top, at `to` or else one cell down and right of the original; always kept on the page */
export function cloneWidget(d: Dashboard, pageId: string, source: Widget, to?: { x: number; y: number }): Widget {
  const page = d.pages.find((p) => p.id === pageId);
  const r = clampRect({ x: to?.x ?? source.x + 1, y: to?.y ?? source.y + 1, w: source.w, h: source.h }, gridOf(d.orientation), minSize(source));
  return { ...source, ...r, id: newId(), z: topZ(page?.widgets ?? []), props: { ...source.props } } as Widget;
}

/** moves a widget within the stacking order; z values are renumbered 0..n-1 so they stay tidy */
export function reorder(d: Dashboard, pageId: string, id: string, how: Order): Dashboard {
  return mapPage(d, pageId, (p) => {
    const order = drawOrder(p.widgets).map((w) => w.id);
    const i = order.indexOf(id);
    if (i < 0) return p;
    const j = how === 'front' ? order.length - 1 : how === 'back' ? 0 : clamp(i + (how === 'forward' ? 1 : -1), 0, order.length - 1);
    if (j === i) return p;
    order.splice(j, 0, order.splice(i, 1)[0]);
    return { ...p, widgets: p.widgets.map((w) => ({ ...w, z: order.indexOf(w.id) })) };
  });
}

// ---------- pages ----------
export function addPage(d: Dashboard, name?: string): Dashboard {
  const page: Page = { id: newId(), name: name ?? `Page ${d.pages.length + 1}`, widgets: [] };
  return { ...d, pages: [...d.pages, page] };
}

export function duplicatePage(d: Dashboard, pageId: string): Dashboard {
  const i = d.pages.findIndex((p) => p.id === pageId);
  if (i < 0) return d;
  const src = d.pages[i];
  const copy: Page = { id: newId(), name: `${src.name} copy`, widgets: src.widgets.map((w) => ({ ...w, id: newId(), props: { ...w.props } }) as Widget) };
  return { ...d, pages: [...d.pages.slice(0, i + 1), copy, ...d.pages.slice(i + 1)] };
}

export function renamePage(d: Dashboard, pageId: string, name: string): Dashboard {
  return mapPage(d, pageId, (p) => (p.name === name ? p : { ...p, name }));
}

/** a dashboard always keeps at least one page */
export function removePage(d: Dashboard, pageId: string): Dashboard {
  return d.pages.length > 1 && d.pages.some((p) => p.id === pageId) ? { ...d, pages: d.pages.filter((p) => p.id !== pageId) } : d;
}

export function movePage(d: Dashboard, pageId: string, delta: number): Dashboard {
  const i = d.pages.findIndex((p) => p.id === pageId);
  const j = clamp(i + delta, 0, d.pages.length - 1);
  if (i < 0 || i === j) return d;
  const pages = [...d.pages];
  pages.splice(j, 0, pages.splice(i, 1)[0]);
  return { ...d, pages };
}

// ---------- dashboard ----------
/** switching orientation re-clamps every widget onto the new grid (33 x 44 cells <-> 44 x 33) */
export function setOrientation(d: Dashboard, orientation: Orientation): Dashboard {
  if (d.orientation === orientation) return d;
  const bounds = gridOf(orientation);
  const pages = d.pages.map((p) => ({
    ...p,
    widgets: p.widgets.map((w) => ({ ...w, ...clampRect(w, bounds, minSize(w)) }) as Widget),
  }));
  return { ...d, orientation, pages };
}

export function patchDashboard(d: Dashboard, patch: Partial<Pick<Dashboard, 'name' | 'schedule' | 'publish'>>): Dashboard {
  return { ...d, ...patch };
}
