// The shared look of the System and Reader widgets: a title, then label / value rows, with a meter under each row that has a fraction.
import { BOLD, REGULAR } from '../text';
import { INK, PAD, drawFitted, drawLine, drawMeter, drawNote } from '../draw';
import type { Result } from '../data';
import type { Ctx2D } from '../draw';
import type { Measure } from '../text';

export type StatRow = { label: string; value: string; /** 0..1; draws a meter when set */ fraction?: number };

export function drawStats(g: Ctx2D, w: number, h: number, title: string, rows: StatRow[], measure: Measure): void {
  if (!rows.length) return drawNote(g, w, h, 'Choose what to show');
  const left = PAD, room = w - PAD * 2;
  let y = PAD;
  if (title) {
    drawFitted(g, title, left, y + 26, room, { size: 44, weight: BOLD });
    y += 58;
    g.fillStyle = INK;
    g.fillRect(left, y, room, 3);
    y += 14;
  }
  const weight = (r: StatRow) => (r.fraction === undefined ? 0.6 : 1);
  const unit = (h - y - PAD) / rows.reduce((sum, r) => sum + weight(r), 0);
  const size = Math.max(24, Math.min(40, Math.floor(unit * 0.36)));
  const meterH = Math.max(18, Math.min(38, Math.floor(unit * 0.3)));

  for (const r of rows) {
    const rowH = unit * weight(r);
    const block = r.fraction === undefined ? size * 1.2 : size * 1.2 + 10 + meterH;
    const top = y + (rowH - block) / 2;
    const cy = top + size * 0.6;
    const valueW = measure(r.value, BOLD, size);
    drawLine(g, r.value, left + room, cy, { size, weight: BOLD, align: 'right' });
    drawFitted(g, r.label, left, cy, room - valueW - 20, { size, weight: REGULAR });
    if (r.fraction !== undefined) drawMeter(g, left, top + size * 1.2 + 10, room, meterH, r.fraction);
    y += rowH;
  }
}

/** the common "unavailable" note for a data widget whose source failed or has not loaded */
export function statsNote(g: Ctx2D, w: number, h: number, what: string, data: Result<unknown> | undefined): boolean {
  if (!data) { drawNote(g, w, h, `Loading ${what}`); return true; }
  if (!data.ok) { drawNote(g, w, h, `${what} unavailable`); return true; }
  return false;
}
