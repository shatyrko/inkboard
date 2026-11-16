// Starting points offered by "New dashboard". Layouts are on the 33 x 44 portrait grid; all names and entries are invented.
import { gridOf, type Rect } from './grid';
import type { PublishFormat } from '../lib/types';
import { createWidget, newDashboard, newPage, type Dashboard, type Widget, type WidgetProps, type WidgetType } from './model';
import { idsOfKind } from './typefaces';

const bounds = gridOf('portrait');

function put<T extends WidgetType>(type: T, at: Rect, props?: Partial<WidgetProps[T]>): Widget {
  return createWidget(type, bounds, at, props) as Widget;
}

const rule = (y: number): Widget => put('box', { x: 1, y, w: 31, h: 1 }, { shape: 'line', stroke: 4 });

function daily(name: string): Dashboard {
  const page = newPage('Today', [
    put('clock', { x: 1, y: 1, w: 31, h: 9 }),
    rule(10),
    put('calendar', { x: 1, y: 12, w: 19, h: 17 }),
    put('countdown', { x: 21, y: 12, w: 11, h: 9 }, { label: 'Next holiday' }),
    put('text', { x: 21, y: 22, w: 11, h: 7 }, { text: '## Focus\nFinish the **draft** before lunch.', size: 34 }),
    rule(30),
    put('checklist', { x: 1, y: 31, w: 31, h: 12 }, {
      title: 'Today',
      items: ['Water the plants', 'Send the invoice', 'Call the plumber', 'Plan the weekend'].map((text, i) => ({ id: `s${i}`, text, done: i === 0 })),
      size: 40,
    }),
  ]);
  return newDashboard(name, [page]);
}

function status(name: string): Dashboard {
  const page = newPage('Status', [
    put('system', { x: 1, y: 1, w: 31, h: 23 }, { rows: ['cpu', 'memory', 'disk', 'battery', 'uptime', 'load'] }),
    rule(25),
    put('reader', { x: 1, y: 26, w: 31, h: 11 }),
    rule(38),
    put('clock', { x: 1, y: 39, w: 31, h: 5 }, { show: 'time', label: 'Updated at' }),
  ]);
  return newDashboard(name, [page]);
}

/** The helper that prints the messages is installed by scripts/telegram/setup.sh (see the README). Text is 30 px, so 80 of the 82 columns that fit are used; 15 messages of 3 lines fill the 45 rows. */
export const TELEGRAM_COMMAND = '~/.config/inkboard/telegram/inkboard-telegram recent 15 --width 80 --lines 2';

function telegram(name: string): Dashboard {
  const page = newPage('Telegram', [
    put('command', { x: 1, y: 1, w: 31, h: 38 }, { command: TELEGRAM_COMMAND, title: 'Latest messages', size: 30 }),
    put('clock', { x: 1, y: 40, w: 31, h: 4 }, { show: 'time', label: 'Updated at' }),
  ]);
  return newDashboard(name, [page]);
}

/**
 * Type tests: every typeface in a ladder of sizes, as many as fit on a page. Sizes are in page pixels (a reader draws about 150 to
 * the inch), so 14 is the smallest anyone would try and 46 is a comfortable reading size.
 */
const LADDER = '14, 18, 22, 28, 36, 56';
const BIG_LADDER = '14, 18, 22, 28, 36, 46, 60';
/** designed to be easy to read: kept together on one page */
const FRIENDLY = ['atkinson', 'lexend'];

function typeTest(name: string, color: boolean): Dashboard {
  const full = { x: 0, y: 0, w: 33, h: 44 };
  const ink = color ? 'color' : 'black';
  const pages = [
    newPage('Serif', [put('specimen', full, { fonts: idsOfKind('serif'), sizes: LADDER, ink })]),
    newPage('Sans', [put('specimen', full, { fonts: idsOfKind('sans').filter((id) => !FRIENDLY.includes(id)), sizes: BIG_LADDER, ink })]),
    newPage('Mono and friendly', [put('specimen', full, { fonts: [...idsOfKind('mono'), ...FRIENDLY, ...idsOfKind('dyslexia')], sizes: BIG_LADDER, ink })]),
    newPage('Bold on tint', [put('specimen', full, { fonts: ['literata', 'merriweather', 'source-serif', 'inter', 'atkinson', 'roboto'], sizes: LADDER, weight: 'bold', backdrop: 'tint', ink })]),
  ];
  const d = newDashboard(name, pages);
  return color ? { ...d, publish: { color: true } } : d;
}

export type Sample = {
  id: string;
  label: string;
  blurb: string;
  make: (name: string) => Dashboard;
  /** the file format to use when the new dashboard goes to a USB reader (the reader's usual one otherwise) */
  format?: PublishFormat;
};

export const SAMPLES: Sample[] = [
  { id: 'blank', label: 'Blank', blurb: 'An empty page', make: (name) => newDashboard(name) },
  { id: 'daily', label: 'Daily', blurb: 'Clock, calendar, countdown and a checklist', make: daily },
  { id: 'status', label: 'Computer status', blurb: 'Computer and reader meters', make: status },
  { id: 'telegram', label: 'Telegram', blurb: 'The 15 newest Telegram messages (needs the helper in scripts/telegram)', make: telegram },
  { id: 'type-gray', label: 'Type test, gray', blurb: 'Typefaces and sizes in grayscale, for the Digital Paper', make: (name) => typeTest(name, false) },
  { id: 'type-color', label: 'Type test, color', blurb: 'The same in color, for a color e-ink screen (pictures)', make: (name) => typeTest(name, true), format: 'png' },
];
