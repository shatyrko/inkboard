import { PAD, SOFT_INK, drawFitted, drawLine, drawNote } from '../draw';
import { BOLD, fitFontSize } from '../text';
import type { WidgetDef } from './types';

/** Whole days from today (local time) to a "YYYY-MM-DD" date: positive for the future, 0 today, negative once passed. Null if the date is invalid. */
export function daysUntil(date: string, now: Date): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const target = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  if (Number.isNaN(target)) return null;
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86_400_000);
}

export function countdownWords(days: number): { big: string; unit: string } {
  if (days === 0) return { big: 'Today', unit: '' };
  const n = Math.abs(days);
  return { big: String(n), unit: `${n === 1 ? 'day' : 'days'} ${days > 0 ? 'left' : 'ago'}` };
}

export const countdownWidget: WidgetDef<'countdown'> = {
  type: 'countdown',
  label: 'Countdown',
  icon: 'timer',
  blurb: 'Days until a date',
  size: { w: 11, h: 9, minW: 5, minH: 4 },
  defaults: () => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { label: 'Holiday', date: iso, border: false };
  },
  fields: [
    { kind: 'text', key: 'label', label: 'Label', placeholder: 'What are you counting down to?' },
    { kind: 'date', key: 'date', label: 'Date' },
    { kind: 'switch', key: 'border', label: 'Border' },
  ],
  draw({ g, w, h, props, env, measure }) {
    const days = daysUntil(props.date, env.now);
    if (days === null) return drawNote(g, w, h, 'Pick a date');
    const { big, unit } = countdownWords(days);
    const room = w - PAD * 2;
    let top = PAD;
    if (props.label) {
      const size = fitFontSize(props.label, BOLD, room, 56, measure, { min: 26, max: 44 });
      drawFitted(g, props.label, w / 2, top + size * 0.7, room, { size, weight: BOLD, align: 'center' });
      top += Math.round(size * 1.5);
    }
    const target = new Date(`${props.date}T00:00:00`).toLocaleDateString(undefined, { dateStyle: 'medium' });
    const footer = 40;
    const area = h - top - PAD - footer - (unit ? 44 : 0);
    const size = fitFontSize(big, BOLD, room, area, measure, { min: 40, max: 360 });
    const cy = top + area / 2;
    drawLine(g, big, w / 2, cy, { size, weight: BOLD, align: 'center' });
    if (unit) drawLine(g, unit, w / 2, cy + size * 0.5 + 28, { size: 36, weight: 600, align: 'center' });
    drawLine(g, target, w / 2, h - PAD - footer / 2, { size: 30, align: 'center', color: SOFT_INK });
  },
};
