import { INK, PAD, PAPER, SOFT_INK, drawFitted, drawLine, roundRect } from '../draw';
import { BOLD } from '../text';
import type { WidgetDef } from './types';

export type MonthGrid = {
  title: string;
  weekdays: string[];
  /** day numbers in reading order, null for the blanks before the 1st and after the last day */
  cells: (number | null)[];
  /** the day of month to highlight */
  today: number;
};

/** The month containing `now` as a week grid; `weekStart` picks Monday or Sunday for the first column. */
export function monthGrid(now: Date, weekStart: 'mon' | 'sun'): MonthGrid {
  const year = now.getFullYear(), month = now.getMonth();
  const days = new Date(year, month + 1, 0).getDate();
  const firstDow = new Date(year, month, 1).getDay(); // 0 = Sunday
  const lead = weekStart === 'mon' ? (firstDow + 6) % 7 : firstDow;
  const cells: (number | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  // 2024-01-01 was a Monday: seven consecutive days give the weekday names in the user's locale
  const names = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: 'short' }));
  return {
    title: now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    weekdays: weekStart === 'mon' ? names : [names[6], ...names.slice(0, 6)],
    cells,
    today: now.getDate(),
  };
}

export const calendarWidget: WidgetDef<'calendar'> = {
  type: 'calendar',
  label: 'Calendar',
  icon: 'calendar',
  blurb: 'This month, today highlighted',
  size: { w: 19, h: 17, minW: 12, minH: 10 },
  defaults: () => ({ weekStart: 'mon', border: false }),
  fields: [
    { kind: 'seg', key: 'weekStart', label: 'Week starts on', options: [{ value: 'mon', label: 'Monday' }, { value: 'sun', label: 'Sunday' }] },
    { kind: 'switch', key: 'border', label: 'Border' },
  ],
  draw({ g, w, h, props, env }) {
    const grid = monthGrid(env.now, props.weekStart);
    const rows = grid.cells.length / 7;
    const left = PAD, room = w - PAD * 2;
    const titleH = Math.min(84, h * 0.13);
    const headH = Math.min(60, h * 0.09);
    const cellW = room / 7;
    const cellH = (h - PAD * 2 - titleH - headH) / rows;
    const numSize = Math.floor(Math.min(cellW * 0.5, cellH * 0.55, 56));

    drawFitted(g, grid.title, left + room / 2, PAD + titleH / 2, room, { size: Math.floor(titleH * 0.6), weight: BOLD, align: 'center' });
    const headY = PAD + titleH;
    grid.weekdays.forEach((name, i) => {
      drawFitted(g, name, left + cellW * (i + 0.5), headY + headH / 2, cellW - 4, { size: Math.max(22, Math.floor(Math.min(headH * 0.5, cellW * 0.32))), weight: 600, align: 'center', color: SOFT_INK });
    });
    g.fillStyle = INK;
    g.fillRect(left, headY + headH - 3, room, 3);

    grid.cells.forEach((day, i) => {
      if (day === null) return;
      const cx = left + cellW * ((i % 7) + 0.5);
      const cy = headY + headH + cellH * (Math.floor(i / 7) + 0.5);
      const isToday = day === grid.today;
      if (isToday) {
        const r = Math.min(cellW, cellH) * 0.9;
        g.fillStyle = INK;
        roundRect(g, cx - r / 2, cy - r / 2, r, r, r * 0.28);
        g.fill();
      }
      drawLine(g, String(day), cx, cy, { size: numSize, weight: isToday ? BOLD : 500, align: 'center', color: isToday ? PAPER : INK });
    });
  },
};
