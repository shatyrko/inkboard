import { describe, expect, it } from 'vitest';
import type { DataBag, Result } from './data';
import { createWidget, newDashboard, newPage, type Widget } from './model';
import { gridOf } from './grid';
import { fakeContext } from './testing';
import { renderPage } from './render';
import { monthGrid } from './widgets/calendar';
import { formatClock } from './widgets/clock';
import { monoLines } from './widgets/command';
import { countdownWords, daysUntil } from './widgets/countdown';
import { readerRows } from './widgets/reader';
import { systemRows } from './widgets/system';
import type { DeviceStatus, SystemStats } from '../lib/types';

const bounds = gridOf('portrait');

describe('monthGrid', () => {
  it('pads the first week by the weekday of the 1st (February 2025 starts on a Saturday)', () => {
    const mon = monthGrid(new Date(2025, 1, 10), 'mon');
    expect(mon.cells.slice(0, 6)).toEqual([null, null, null, null, null, 1]);
    expect(mon.cells).toHaveLength(35);
    const sun = monthGrid(new Date(2025, 1, 10), 'sun');
    expect(sun.cells.slice(0, 7)).toEqual([null, null, null, null, null, null, 1]);
    expect(mon.today).toBe(10);
    expect(mon.cells.filter((c) => c !== null)).toHaveLength(28);
  });

  it('adds a sixth week when the month needs it and handles leap years', () => {
    expect(monthGrid(new Date(2025, 2, 1), 'mon').cells).toHaveLength(42); // March 2025: 1st is a Saturday, 31 days
    expect(monthGrid(new Date(2024, 1, 29), 'mon').cells.filter((c) => c !== null)).toHaveLength(29);
  });

  it('starts the weekday header on Sunday or Monday', () => {
    const mon = monthGrid(new Date(2025, 0, 1), 'mon').weekdays;
    const sun = monthGrid(new Date(2025, 0, 1), 'sun').weekdays;
    expect(sun[0]).toBe(mon[6]);
    expect(sun.slice(1)).toEqual(mon.slice(0, 6));
  });
});

describe('countdown', () => {
  const now = new Date(2025, 2, 10, 23, 59);

  it('counts whole calendar days, ignoring the time of day', () => {
    expect(daysUntil('2025-03-10', now)).toBe(0);
    expect(daysUntil('2025-03-11', now)).toBe(1);
    expect(daysUntil('2025-12-25', now)).toBe(290);
    expect(daysUntil('2025-03-01', now)).toBe(-9);
  });

  it('rejects dates it cannot read', () => {
    expect(daysUntil('', now)).toBeNull();
    expect(daysUntil('10/03/2025', now)).toBeNull();
  });

  it('words the result', () => {
    expect(countdownWords(0)).toEqual({ big: 'Today', unit: '' });
    expect(countdownWords(1)).toEqual({ big: '1', unit: 'day left' });
    expect(countdownWords(12)).toEqual({ big: '12', unit: 'days left' });
    expect(countdownWords(-3)).toEqual({ big: '3', unit: 'days ago' });
  });
});

describe('formatClock', () => {
  const at = new Date('2025-03-03T15:07:00Z');
  const base = { show: 'both', hour12: false, dateStyle: 'full', timezone: 'UTC', label: '', align: 'center', border: false } as const;

  it('formats the time in the chosen zone and separates the am/pm marker', () => {
    expect(formatClock(at, base)).toMatchObject({ time: '15:07', period: '' });
    const twelve = formatClock(at, { ...base, hour12: true });
    expect(twelve.time).toBe('3:07');
    expect(twelve.period).not.toBe('');
  });

  it('falls back to this computer for a zone it does not know', () => {
    expect(() => formatClock(at, { ...base, timezone: 'Not/AZone' })).not.toThrow();
  });
});

describe('monoLines', () => {
  it('wraps long lines hard, expands tabs and trims the end', () => {
    expect(monoLines('abcdefgh\n\tx  \n\n', 5)).toEqual(['abcde', 'fgh', '    x']);
    expect(monoLines('', 5)).toEqual(['']);
  });
});

const stats: SystemStats = {
  cpuPercent: 42.4, memUsed: 8e9, memTotal: 16e9, swapUsed: 0, swapTotal: 0, uptimeSecs: 90_000, load: [0.5, 0.25, 0.125],
  disks: [{ mount: '/boot', total: 1e9, available: 5e8 }, { mount: '/', total: 5e11, available: 2e11 }], battery: { level: 80, charging: true }, os: 'Linux', hostname: 'host',
};

describe('systemRows', () => {
  it('builds the chosen rows in a fixed order, with meters where there is a fraction', () => {
    const rows = systemRows(stats, ['uptime', 'cpu', 'disk', 'battery']);
    expect(rows.map((r) => r.label)).toEqual(['CPU', 'Disk', 'Battery (charging)', 'Uptime']);
    expect(rows[0]).toMatchObject({ value: '42%', fraction: 0.424 });
    expect(rows[1].fraction).toBeCloseTo(0.6);
    expect(rows[3].fraction).toBeUndefined();
  });

  it('copes with no swap and no battery', () => {
    const rows = systemRows({ ...stats, battery: null }, ['swap', 'battery', 'load']);
    expect(rows).toEqual([{ label: 'Swap', value: 'none' }, { label: 'Battery', value: 'none' }, { label: 'Load', value: '0.50  0.25  0.13' }]);
  });
});

describe('readerRows', () => {
  it('shows battery, pen and storage use', () => {
    const s = { battery: { level: 70, pen: 40, charging: false }, storage: { available: 3e9, capacity: 12e9 } } as DeviceStatus;
    const rows = readerRows(s, ['battery', 'pen', 'storage']);
    expect(rows.map((r) => r.value)).toEqual(['70%', '40%', '9.0 GB / 12.0 GB']);
    expect(rows[2].fraction).toBeCloseTo(0.75);
  });
});

// ---------- drawing with a recording context ----------
function page(...widgets: Widget[]) {
  const d = newDashboard('T', [newPage('One', widgets)]);
  return d;
}
const bag = (results: DataBag['results'] = {}): DataBag => ({ now: new Date(2025, 2, 3, 9, 5), results });
const draw = (d: ReturnType<typeof page>, data = bag()) => {
  const { g, calls, texts } = fakeContext();
  renderPage(g, d.pages[0], data, { width: 1650, height: 2200, dashboard: d, pageIndex: 0 });
  return { calls, texts: texts() };
};

describe('renderPage', () => {
  it('paints the page white, then clips and translates each widget to its box', () => {
    const { calls } = draw(page(createWidget('box', bounds, { x: 2, y: 3, w: 4, h: 2 })));
    expect(calls[1]).toMatchObject({ op: 'fillRect', args: [0, 0, 1650, 2200] });
    expect(calls.some((c) => c.op === 'translate' && c.args[0] === 100 && c.args[1] === 150)).toBe(true);
    expect(calls.some((c) => c.op === 'rect' && c.args[2] === 200 && c.args[3] === 100)).toBe(true);
  });

  it('draws widgets bottom to top by z', () => {
    const a = createWidget('text', bounds, { x: 0, y: 0 }, { text: 'under' }, 5);
    const b = createWidget('text', bounds, { x: 0, y: 0 }, { text: 'over' }, 1);
    expect(draw(page(a, b)).texts).toEqual(['over', 'under']);
  });

  it('draws text widgets: headings and bullets from the markdown', () => {
    const w = createWidget('text', bounds, {}, { text: '# Title\n- one\nplain' });
    const { texts } = draw(page(w));
    expect(texts).toContain('Title');
    expect(texts).toContain('one');
  });

  it('says "unavailable" instead of failing when a data source failed', () => {
    const w = createWidget('system', bounds);
    const failed: Result<never> = { ok: false, error: 'no access' };
    expect(draw(page(w), bag({ system: failed })).texts.join(' ')).toContain('Computer status unavailable');
    expect(draw(page(createWidget('reader', bounds)), bag({ reader: failed })).texts.join(' ')).toContain('Reader status unavailable');
  });

  it('shows the Settings note for a command that is disabled, not a crash', () => {
    const w = createWidget('command', bounds, {}, { command: 'uptime' });
    const r: Result<never> = { ok: false, error: 'x', code: 'disabled' };
    expect(draw(page(w), bag({ 'cmd:uptime': r })).texts).toContain('Commands are disabled in Settings');
  });

  it('shows a web value with prefix and suffix, and "unavailable" for a bad path', () => {
    const w = createWidget('web', bounds, {}, { url: 'https://example.com/x', path: 'a.b', prefix: '~', suffix: ' C' });
    const good = draw(page(w), bag({ 'web:https://example.com/x': { ok: true, value: '{"a":{"b":21}}' } }));
    expect(good.texts).toContain('~21 C');
    const bad = draw(page(w), bag({ 'web:https://example.com/x': { ok: true, value: '{"a":1}' } }));
    expect(bad.texts).toContain('Web data unavailable');
  });

  it('draws the page tabs with every page name', () => {
    const d = newDashboard('T', [newPage('Home'), newPage('Stats')]);
    d.pages[0].widgets.push(createWidget('nav', bounds));
    const { g, texts } = fakeContext();
    renderPage(g, d.pages[0], bag(), { width: 1650, height: 2200, dashboard: d, pageIndex: 0 });
    expect(texts()).toEqual(['Home', 'Stats']);
  });

  it('a widget that throws does not stop the others', () => {
    const w = createWidget('text', bounds, {}, { text: 'fine' });
    const broken = createWidget('checklist', bounds);
    (broken.props as { items: unknown }).items = null;
    expect(draw(page(broken, w)).texts).toContain('fine');
  });
});
