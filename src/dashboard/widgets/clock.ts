import { PAD, SOFT_INK, alignX, anchorX, drawFitted, drawLine } from '../draw';
import { BOLD } from '../text';
import { fitFontSize } from '../text';
import type { WidgetProps } from '../model';
import type { WidgetDef } from './types';

type ClockProps = WidgetProps['clock'];

/** a zone name Intl accepts, or undefined for "this computer's zone" */
function validZone(tz: string): string | undefined {
  if (!tz.trim()) return undefined;
  try { new Intl.DateTimeFormat(undefined, { timeZone: tz.trim() }); return tz.trim(); } catch { return undefined; }
}

/** The pieces the widget draws. The am/pm marker is separate so it can be set smaller than the digits. */
export function formatClock(now: Date, p: ClockProps): { time: string; period: string; date: string } {
  const timeZone = validZone(p.timezone);
  const parts = new Intl.DateTimeFormat(undefined, { hour: p.hour12 ? 'numeric' : '2-digit', minute: '2-digit', hourCycle: p.hour12 ? 'h12' : 'h23', timeZone }).formatToParts(now);
  return {
    time: parts.filter((x) => x.type !== 'dayPeriod').map((x) => x.value).join('').trim(),
    period: parts.find((x) => x.type === 'dayPeriod')?.value ?? '',
    date: new Intl.DateTimeFormat(undefined, { dateStyle: p.dateStyle, timeZone }).format(now),
  };
}

export const clockWidget: WidgetDef<'clock'> = {
  type: 'clock',
  label: 'Clock',
  icon: 'clock',
  blurb: 'Time and date as of the last push',
  size: { w: 31, h: 10, minW: 6, minH: 2 },
  defaults: () => ({ show: 'both', hour12: false, dateStyle: 'full', timezone: '', label: '', align: 'center', border: false }),
  fields: [
    { kind: 'seg', key: 'show', label: 'Show', options: [{ value: 'both', label: 'Both' }, { value: 'time', label: 'Time' }, { value: 'date', label: 'Date' }] },
    { kind: 'switch', key: 'hour12', label: '12-hour clock', when: (p) => p.show !== 'date' },
    { kind: 'select', key: 'dateStyle', label: 'Date format', when: (p) => p.show !== 'time', options: [
      { value: 'full', label: 'Full (Monday, 3 March 2025)' }, { value: 'long', label: 'Long (3 March 2025)' },
      { value: 'medium', label: 'Medium (3 Mar 2025)' }, { value: 'short', label: 'Short (3/3/25)' },
    ] },
    { kind: 'text', key: 'timezone', label: 'Time zone', placeholder: 'This computer', hint: 'An IANA name such as Europe/Berlin. The time is that of the push.' },
    { kind: 'text', key: 'label', label: 'Label', placeholder: 'e.g. Berlin' },
    { kind: 'seg', key: 'align', label: 'Align', options: [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }] },
    { kind: 'switch', key: 'border', label: 'Border' },
  ],
  draw({ g, w, h, props: p, env, measure }) {
    const { time, period, date } = formatClock(env.now, p);
    const left = PAD, room = w - PAD * 2;
    let top = PAD, avail = h - PAD * 2;
    if (p.label) {
      drawFitted(g, p.label, anchorX(p.align, left, room), top + 18, room, { size: 32, weight: BOLD, align: p.align, color: SOFT_INK });
      top += 44;
      avail -= 44;
    }
    const showTime = p.show !== 'date', showDate = p.show !== 'time';
    const timeH = showTime && showDate ? avail * 0.66 : avail;
    const dateH = showDate && showTime ? avail - timeH : avail;

    let timeSize = 0;
    if (showTime) {
      // the am/pm marker takes 0.4 em of the digits' size, plus a gap
      const periodShare = period ? (measure(period, BOLD, 40) / 100) + 0.12 : 0;
      const perPx = measure(time, BOLD, 100) / 100 + periodShare;
      timeSize = Math.floor(Math.min(room / perPx, timeH / 1.15, 420));
      const total = measure(time, BOLD, timeSize) + (period ? measure(period, BOLD, timeSize * 0.4) + timeSize * 0.12 : 0);
      const x = alignX(p.align, left, room, total);
      const cy = top + timeH / 2;
      drawLine(g, time, x, cy, { size: timeSize, weight: BOLD });
      if (period) drawLine(g, period, x + measure(time, BOLD, timeSize) + timeSize * 0.12, cy + timeSize * 0.2, { size: timeSize * 0.4, weight: BOLD });
    }
    if (showDate) {
      const cap = showTime ? Math.max(32, timeSize * 0.42) : 200;
      const size = fitFontSize(date, BOLD, room, dateH, measure, { min: 24, max: cap });
      drawFitted(g, date, anchorX(p.align, left, room), top + (showTime ? timeH : 0) + dateH / 2, room, { size, weight: 600, align: p.align });
    }
  },
};
