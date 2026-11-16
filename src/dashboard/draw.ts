// Canvas helpers shared by the widgets. Everything is in full-size page pixels (a page is 1650 x 2200).
// E-ink rules baked in: pure black on white, strokes of at least 2 px, gray fills only from the 16-level palette.
import { font, SANS } from './fonts';
import { REGULAR, ellipsize, wrapRuns, type Layout, type Measure } from './text';
import type { Align, FillLevel, Valign } from './model';

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export const INK = '#000000';
export const PAPER = '#ffffff';
/** secondary text and "done" items: dark enough to stay readable on 16 grays */
export const SOFT_INK = '#555555';
export const FILLS: Record<FillLevel, string | null> = { none: null, light: '#eeeeee', medium: '#cccccc', dark: '#888888', black: INK };

/** inner padding every widget keeps from its own edge */
export const PAD = 16;
/** vertical offset from a line's centre to its text baseline, as a fraction of the font size (optically centres Inter) */
const CAP_CENTER = 0.36;

export const measurer = (g: Ctx2D, family = SANS): Measure => (text, weight, size) => {
  g.font = font(weight, size, family);
  return g.measureText(text).width;
};

export type TextOpts = { size: number; weight?: number; align?: Align; color?: string; family?: string };

/** draws one line of text vertically centred on `cy`; `x` is its left, centre or right edge depending on `align` */
export function drawLine(g: Ctx2D, text: string, x: number, cy: number, o: TextOpts): void {
  g.font = font(o.weight ?? REGULAR, o.size, o.family);
  g.fillStyle = o.color ?? INK;
  g.textAlign = o.align ?? 'left';
  g.textBaseline = 'alphabetic';
  g.fillText(text, x, cy + o.size * CAP_CENTER);
}

/** like drawLine, but shortens the text with an ellipsis to fit `maxWidth` */
export function drawFitted(g: Ctx2D, text: string, x: number, cy: number, maxWidth: number, o: TextOpts): void {
  const shown = ellipsize(text, maxWidth, o.weight ?? REGULAR, o.size, measurer(g, o.family));
  drawLine(g, shown, x, cy, o);
}

/** the left edge for something `width` px wide aligned inside [left, left + room] */
export const alignX = (align: Align, left: number, room: number, width: number) =>
  align === 'center' ? left + (room - width) / 2 : align === 'right' ? left + room - width : left;

/** the x to pass to drawLine for text aligned inside [left, left + room] */
export const anchorX = (align: Align, left: number, room: number) =>
  align === 'center' ? left + room / 2 : align === 'right' ? left + room : left;

/** a centred, quiet message (wrapped, up to the room there is): used for "unavailable", "loading" and unset widgets */
export function drawNote(g: Ctx2D, w: number, h: number, text: string, sub?: string): void {
  const size = Math.max(24, Math.min(36, Math.floor(w / 14)));
  const m = measurer(g);
  const lines = (src: string, s: number) => wrapRuns([{ text: src, bold: false }], w - PAD * 2, s, REGULAR, m).map((l) => l.runs.map((r) => r.text).join(''));
  const rows = [...lines(text, size).map((t) => ({ t, s: size })), ...(sub ? lines(sub, Math.round(size * 0.8)).map((t) => ({ t, s: Math.round(size * 0.8) })) : [])];
  const lineH = Math.round(size * 1.3);
  const fit = Math.max(1, Math.floor((h - PAD * 2) / lineH));
  const shown = rows.slice(0, fit);
  const top = (h - shown.length * lineH) / 2;
  shown.forEach((r, i) => {
    const last = i === shown.length - 1 && rows.length > shown.length;
    drawLine(g, last ? ellipsize(r.t + ' \u2026', w - PAD * 2, REGULAR, r.s, m) : r.t, w / 2, top + i * lineH + lineH / 2, { size: r.s, align: 'center', color: SOFT_INK });
  });
}

export function roundRect(g: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + k, y);
  g.arcTo(x + w, y, x + w, y + h, k);
  g.arcTo(x + w, y + h, x, y + h, k);
  g.arcTo(x, y + h, x, y, k);
  g.arcTo(x, y, x + w, y, k);
  g.closePath();
}

/** the optional widget border: 4 px, inset so it is never clipped */
export function drawFrame(g: Ctx2D, w: number, h: number): void {
  g.strokeStyle = INK;
  g.lineWidth = 4;
  roundRect(g, 2, 2, w - 4, h - 4, 14);
  g.stroke();
}

/** a horizontal progress bar: 3 px outline, solid black fill */
export function drawMeter(g: Ctx2D, x: number, y: number, w: number, h: number, fraction: number): void {
  const f = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  g.strokeStyle = INK;
  g.lineWidth = 3;
  roundRect(g, x + 1.5, y + 1.5, w - 3, h - 3, h / 2);
  g.stroke();
  if (f <= 0) return;
  g.fillStyle = INK;
  const inner = h - 12;
  roundRect(g, x + 6, y + 6, Math.max(inner, (w - 12) * f), inner, inner / 2);
  g.fill();
}

/** Draws a wrapped markdown layout inside a box. Lines that do not fit are dropped and the last one gets an ellipsis. */
export function drawLayout(g: Ctx2D, layout: Layout, box: { x: number; y: number; w: number; h: number }, align: Align, valign: Valign, family = SANS): void {
  const fits = layout.lines.filter((l) => l.top + l.height <= box.h + 1);
  const cut = fits.length < layout.lines.length;
  const shown = fits.length ? fits : layout.lines.slice(0, 1);
  const used = shown.length ? shown[shown.length - 1].top + shown[shown.length - 1].height : 0;
  const offset = valign === 'middle' ? Math.max(0, (box.h - used) / 2) : valign === 'bottom' ? Math.max(0, box.h - used) : 0;

  shown.forEach((line, i) => {
    const left = alignX(align, box.x, box.w, line.width);
    const cy = box.y + offset + line.top + line.height / 2;
    if (line.bullet !== null) {
      g.fillStyle = INK;
      g.beginPath();
      g.arc(left + line.size * 0.3, cy, line.size * 0.11, 0, Math.PI * 2);
      g.fill();
    }
    line.runs.forEach((run) => drawLine(g, run.text, left + run.x, cy, { size: line.size, weight: run.weight, family }));
    if (cut && i === shown.length - 1) drawLine(g, '…', left + line.width + line.size * 0.15, cy, { size: line.size, weight: line.weight, family });
  });
}
