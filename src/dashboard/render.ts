// The one drawing path: the editor preview and the published bitmap both call renderPage(), so what you see is what the reader shows.
// It only needs a 2D context, in full-size page pixels; the caller sets any scaling beforehand.
import type { DataBag, Source } from './data';
import { INK, PAPER, drawFrame, drawNote, measurer, type Ctx2D } from './draw';
import { ensureFonts, ensureTypefaces, fontSample } from './fonts';
import { toPixels } from './grid';
import type { Dashboard, Page, Widget } from './model';
import { registry } from './widgets';
import type { AnyWidgetDef } from './widgets/types';

export type RenderOptions = {
  width: number;
  height: number;
  dashboard: Dashboard;
  pageIndex: number;
  /** draw color where a widget can (the dashboard is published in color); default false */
  color?: boolean;
};

const defOf = (w: Widget): AnyWidgetDef => registry[w.type];

/** bottom to top: by z, then by position in the list */
export function drawOrder(widgets: Widget[]): Widget[] {
  return widgets
    .map((w, i) => ({ w, i }))
    .sort((a, b) => (a.w.z ?? 0) - (b.w.z ?? 0) || a.i - b.i)
    .map((x) => x.w);
}

/** what a widget needs loaded before it can be drawn, or null */
export function sourceOf(w: Widget): Source | null {
  return defOf(w).source?.(w.props) ?? null;
}

/** every font the dashboard needs, loaded: the interface font for its text and the typefaces that widgets name */
export async function ensureDashboardFonts(d: Dashboard, data: DataBag): Promise<void> {
  const needs = d.pages.flatMap((p) => p.widgets.flatMap((w) => defOf(w).fonts?.(w.props) ?? []));
  await Promise.all([ensureFonts(fontSample(d, data)), ensureTypefaces(needs)]);
}

export function renderPage(g: Ctx2D, page: Page, data: DataBag, opts: RenderOptions): void {
  g.save();
  g.fillStyle = PAPER;
  g.fillRect(0, 0, opts.width, opts.height);
  const measure = measurer(g);
  const env = { now: data.now, pages: opts.dashboard.pages, pageIndex: opts.pageIndex, color: opts.color === true };

  for (const widget of drawOrder(page.widgets)) {
    const def = defOf(widget);
    const r = toPixels(widget);
    const source = def.source?.(widget.props);
    g.save();
    g.translate(r.x, r.y);
    g.beginPath();
    g.rect(0, 0, r.w, r.h);
    g.clip();
    g.fillStyle = INK;
    g.strokeStyle = INK;
    g.lineWidth = 2;
    g.setLineDash([]);
    try {
      def.draw({ g, w: r.w, h: r.h, props: widget.props, data: source ? data.results[source.key] : undefined, env, measure });
      if ((widget.props as { border?: boolean }).border) drawFrame(g, r.w, r.h);
    } catch {
      // one broken widget must not take the whole page down
      drawNote(g, r.w, r.h, 'Could not draw this widget');
    }
    g.restore();
  }
  g.restore();
}
