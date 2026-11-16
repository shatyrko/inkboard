import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { DataBag } from './data';
import { gridOf } from './grid';
import { createWidget, migrateDashboard, newDashboard, newPage, type Dashboard } from './model';
import { buildMeta, rgbFromRgba } from './publish';
import { colorOf } from './publish-target';
import { renderPage } from './render';
import { SAMPLES } from './samples';
import { fakeContext } from './testing';
import { TYPEFACES, familyName, idsOfKind, typefaceById } from './typefaces';
import { INKS, LAYOUT, TINTS_COLOR, TINTS_GRAY, fillLine, parseSizes, planSpecimen } from './widgets/specimen';

const bounds = gridOf('portrait');
const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
const faces = (...ids: string[]) => ids.map((id) => typefaceById(id)!);

describe('typefaces', () => {
  it('has unique ids and names, and every id resolves', () => {
    expect(new Set(TYPEFACES.map((t) => t.id)).size).toBe(TYPEFACES.length);
    expect(new Set(TYPEFACES.map((t) => t.name)).size).toBe(TYPEFACES.length);
    for (const t of TYPEFACES) expect(typefaceById(t.id)).toBe(t);
    expect(idsOfKind('mono')).toEqual(['jetbrains-mono', 'plex-mono']);
  });

  it('only names families that the bundled font packages define', () => {
    const css = readFileSync(here('../typefaces.css'), 'utf8');
    const known = new Set<string>(['Inter Variable']); // Inter is imported by style.css
    for (const m of css.matchAll(/@import '([^']+)'/g)) {
      const file = readFileSync(here(`../../node_modules/${m[1]}`), 'utf8');
      for (const f of file.matchAll(/font-family:\s*'([^']+)'/g)) known.add(f[1]);
    }
    for (const t of TYPEFACES) expect(known, `${t.name}: ${familyName(t.family)}`).toContain(familyName(t.family));
  });
});

describe('parseSizes', () => {
  it('reads numbers separated by commas, spaces or semicolons, in order, each once', () => {
    expect(parseSizes('16, 20 26;34')).toEqual([16, 20, 26, 34]);
    expect(parseSizes('20,20, 20')).toEqual([20]);
    expect(parseSizes('12.6')).toEqual([13]);
  });

  it('drops what is not a size: text, tiny or huge numbers, and more than fourteen', () => {
    expect(parseSizes('abc, 4, 500, -3, 30')).toEqual([30]);
    expect(parseSizes('')).toEqual([]);
    expect(parseSizes(Array.from({ length: 30 }, (_, i) => 10 + i).join(','))).toHaveLength(14);
  });
});

describe('fillLine', () => {
  const half = (text: string, _weight: number, size: number) => text.length * size * 0.5;
  it('adds whole words from the sample, over and over, while they fit', () => {
    expect(fillLine('one two', 100, 10, 400, half)).toBe('one two one two one'); // 19 chars x 5 px = 95; one more word makes 115
    expect(fillLine('one two', 100, 10, 400, half).length * 5).toBeLessThanOrEqual(100);
    expect(fillLine('one two', 20, 10, 400, half)).toBe('one'); // a word is never cut
  });
  it('is empty when not even one word fits, or there is no sample', () => {
    expect(fillLine('enormous', 10, 10, 400, half)).toBe('');
    expect(fillLine('   ', 100, 10, 400, half)).toBe('');
  });
});

describe('planSpecimen', () => {
  const base = { w: 1650, h: 2200, sizes: [14, 18, 22, 28, 36, 46], columns: 1, labels: true };

  it('stacks blocks: a name, then one line per size, each line as tall as its size needs', () => {
    const { items, hidden } = planSpecimen({ ...base, faces: faces('inter', 'lora') });
    expect(hidden).toBe(0);
    expect(items.filter((i) => i.kind === 'head').map((i) => (i.kind === 'head' ? i.face.id : ''))).toEqual(['inter', 'lora']);
    const lines = items.filter((i) => i.kind === 'line');
    expect(lines).toHaveLength(12);
    expect(lines[0]).toMatchObject({ x: 16, size: 14, step: 0, h: Math.round(14 * LAYOUT.lineFactor) });
    // nothing overlaps and nothing leaves the page
    for (let i = 1; i < items.length; i++) expect(items[i].y).toBeGreaterThanOrEqual(items[i - 1].y + items[i - 1].h);
    for (const it of items) expect(it.y + it.h).toBeLessThanOrEqual(2200 - 16);
  });

  it('fits eight typefaces with six sizes on a standard page', () => {
    const { items, hidden } = planSpecimen({ ...base, faces: faces(...idsOfKind('serif')) });
    expect(idsOfKind('serif')).toHaveLength(8);
    expect(hidden).toBe(0);
    expect(items.filter((i) => i.kind === 'line')).toHaveLength(48);
  });

  it('starts a new column when a block does not fit, and counts what has no room left', () => {
    const two = planSpecimen({ ...base, columns: 2, h: 600, faces: faces('inter', 'lora', 'roboto') });
    const xs = new Set(two.items.map((i) => i.x));
    expect(xs.size).toBe(2);
    expect(two.hidden).toBeGreaterThanOrEqual(0);
    const one = planSpecimen({ ...base, h: 500, faces: faces('inter', 'lora', 'roboto', 'lexend') });
    expect(one.hidden).toBe(3); // only the first block fits in one column
    expect(one.items.every((i) => i.face.id === 'inter')).toBe(true);
  });

  it('a block taller than the box is cut line by line instead of overflowing', () => {
    const { items } = planSpecimen({ ...base, h: 200, faces: faces('inter') });
    for (const it of items) expect(it.y + it.h).toBeLessThanOrEqual(200 - 16);
    expect(items.filter((i) => i.kind === 'line').length).toBeLessThan(6);
  });

  it('without labels there are no names, and the lines start at the top', () => {
    const { items } = planSpecimen({ ...base, labels: false, faces: faces('inter') });
    expect(items.every((i) => i.kind === 'line')).toBe(true);
    expect(items[0].y).toBe(16);
  });
});

describe('the specimen widget', () => {
  const dashboard = (props: Record<string, unknown>): Dashboard => {
    const d = newDashboard('T', [newPage('P', [createWidget('specimen', bounds, { x: 0, y: 0, w: 33, h: 44 }, props)])]);
    return d;
  };
  const bag: DataBag = { now: new Date(2025, 2, 3, 9, 5), results: {} };
  const draw = (d: Dashboard, color: boolean) => {
    const { g, calls, texts } = fakeContext();
    renderPage(g, d.pages[0], bag, { width: 1650, height: 2200, dashboard: d, pageIndex: 0, color });
    return { calls, texts: texts() };
  };

  it('writes the sample once per typeface and size, with the names and sizes next to them', () => {
    const { texts } = draw(dashboard({ fonts: ['lora', 'inter'], sizes: '20, 30', sample: 'Hello  world', labels: true, fill: false }), false);
    expect(texts.filter((t) => t === 'Hello world')).toHaveLength(4);
    expect(texts).toContain('20');
    expect(texts).toContain('30');
    expect(texts.some((t) => t.startsWith('Lora'))).toBe(true);
    expect(texts.some((t) => t.startsWith('Inter'))).toBe(true);
  });

  it('asks for the fonts it draws with', () => {
    const w = createWidget('specimen', bounds, {}, { fonts: ['lora', 'nope'], weight: 'bold', sample: 'Abc', sizes: '16' });
    const needs = (w.props.fonts as string[]).length; // the unknown id is kept in the props and skipped when drawing
    expect(needs).toBe(2);
  });

  it('uses colored ink only on a page that is published in color', () => {
    const d = dashboard({ fonts: ['inter'], sizes: '20, 30, 40', ink: 'color', fill: false });
    const sample = (color: boolean) => draw(d, color).calls.filter((c) => c.op === 'fillText' && String(c.args[0]).startsWith('Sphinx')).map((c) => c.fillStyle);
    expect(sample(false)).toEqual(['#000000', '#000000', '#000000']);
    expect(sample(true)).toEqual([INKS[0], INKS[1], INKS[2]]);
    expect(INKS.every((c) => /^#[0-9a-f]{6}$/.test(c))).toBe(true);
  });

  it('tints the lines: grays on a gray page, pastels on a color page', () => {
    const d = dashboard({ fonts: ['inter'], sizes: '20, 30', backdrop: 'tint' });
    const fills = (color: boolean) => draw(d, color).calls.filter((c) => c.op === 'fillRect' && (c.args[2] as number) < 1650).map((c) => c.fillStyle);
    expect(fills(false)).toEqual(TINTS_GRAY.slice(0, 2));
    expect(fills(true)).toEqual(TINTS_COLOR.slice(0, 2));
  });

  it('repeats the sample along the line when asked, and keeps the line inside its box', () => {
    const lines = draw(dashboard({ fonts: ['inter'], sizes: '20, 40', sample: 'ab cd', fill: true, labels: false }), false).texts;
    expect(lines).toHaveLength(2);
    expect(lines[0].startsWith('ab cd ab cd ab cd')).toBe(true);
    expect(lines[0].length).toBeGreaterThan(lines[1].length); // the smaller size fits more words
    // the fake canvas is 0.5 em wide per character, the widget 1650 - 2 x 16 px
    expect(lines[0].length * 20 * 0.5).toBeLessThanOrEqual(1618);
    expect(lines[1].length * 40 * 0.5).toBeLessThanOrEqual(1618);
  });

  it('says what is missing instead of drawing nothing', () => {
    expect(draw(dashboard({ fonts: [] }), false).texts.join(' ')).toContain('Pick some typefaces');
    expect(draw(dashboard({ sizes: 'x' }), false).texts.join(' ')).toContain('Set the sizes');
    expect(draw(dashboard({ fonts: ['nope'] }), false).texts.join(' ')).toContain('Pick some typefaces');
  });

  it('survives a stored document with wrong value types', () => {
    const d = migrateDashboard({ pages: [{ widgets: [{ type: 'specimen', x: 0, y: 0, w: 33, h: 44, props: { fonts: 'lora', columns: 9, sizes: 4, ink: 'rainbow' } }] }] });
    const p = d.pages[0].widgets[0].props as { fonts: string[]; columns: number; sizes: string };
    expect(Array.isArray(p.fonts)).toBe(true);
    expect(p.columns).toBeLessThanOrEqual(3);
    expect(typeof p.sizes).toBe('string');
  });
});

describe('color publishing', () => {
  const usb = (format: 'pdf' | 'png' | 'template', color?: boolean): Dashboard => ({
    ...newDashboard('Test'),
    publish: { target: { kind: 'mtp', readerId: 'mtp:1', folder: '', format }, ...(color === undefined ? {} : { color }) },
  });

  it('is on only for pictures and PDFs on a USB reader that asked for it', () => {
    expect(colorOf(usb('png', true))).toBe(true);
    expect(colorOf(usb('pdf', true))).toBe(true);
    expect(colorOf(usb('template', true))).toBe(false);
    expect(colorOf(usb('png'))).toBe(false);
    expect(colorOf({ ...newDashboard('Sony'), publish: { color: true } })).toBe(false); // the Digital Paper is gray
    expect(colorOf(null)).toBe(false);
  });

  it('tells the Rust side when the pixels are RGB', () => {
    const pages = [{ width: 4, height: 4, links: [] }];
    expect(buildMeta(usb('png', true), pages, { displayAfterPush: false }).color).toBe(true);
    expect(buildMeta(usb('png'), pages, { displayAfterPush: false })).not.toHaveProperty('color');
    expect(buildMeta({ ...newDashboard('Sony'), publish: { color: true } }, pages, { displayAfterPush: true })).not.toHaveProperty('color');
  });

  it('keeps the choice in the stored document', () => {
    const d = migrateDashboard(JSON.parse(JSON.stringify(usb('png', true))));
    expect(d.publish?.color).toBe(true);
    expect(migrateDashboard({ publish: { color: 'yes' } }).publish).not.toHaveProperty('color');
  });

  it('rgbFromRgba drops the alpha channel and keeps the order', () => {
    const out = new Uint8Array(2 + 6);
    rgbFromRgba(new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]), out, 2);
    expect([...out]).toEqual([0, 0, 1, 2, 3, 4, 5, 6]);
  });
});

describe('the type test samples', () => {
  const sample = (id: string) => SAMPLES.find((s) => s.id === id)!;

  it('have four pages of specimens that name only real typefaces, every typeface at least once', () => {
    for (const id of ['type-gray', 'type-color']) {
      const d = sample(id).make('Type');
      expect(d.pages).toHaveLength(4);
      const used = new Set<string>();
      for (const page of d.pages) {
        expect(page.widgets).toHaveLength(1);
        const w = page.widgets[0];
        expect(w.type).toBe('specimen');
        for (const f of (w.props as { fonts: string[] }).fonts) { expect(typefaceById(f), f).toBeTruthy(); used.add(f); }
      }
      expect([...used].sort()).toEqual(TYPEFACES.map((t) => t.id).filter((t) => used.has(t)).sort());
      for (const t of TYPEFACES) expect(used, t.id).toContain(t.id);
    }
  });

  it('show every typeface they list: nothing is pushed off the page', () => {
    for (const id of ['type-gray', 'type-color']) {
      for (const page of sample(id).make('Type').pages) {
        const p = page.widgets[0].props as { fonts: string[]; sizes: string; columns: number; labels: boolean };
        const { hidden } = planSpecimen({ w: 1650, h: 2200, faces: faces(...p.fonts), sizes: parseSizes(p.sizes), columns: p.columns, labels: p.labels });
        expect(hidden, `${id} ${page.name}`).toBe(0);
      }
    }
  });

  it('the color one asks for color and for pictures, the gray one does neither', () => {
    expect(sample('type-color').make('x').publish?.color).toBe(true);
    expect(sample('type-color').format).toBe('png');
    expect(sample('type-gray').make('x').publish?.color).toBeUndefined();
    expect(sample('type-gray').format).toBeUndefined();
    expect(sample('type-color').make('x').pages.every((p) => (p.widgets[0].props as { ink: string }).ink === 'color')).toBe(true);
    expect(sample('type-gray').make('x').pages.every((p) => (p.widgets[0].props as { ink: string }).ink === 'black')).toBe(true);
  });
});
