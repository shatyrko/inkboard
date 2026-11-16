// A type specimen: the same sample line in several typefaces and sizes, packed onto the widget, for choosing what reads well on a
// given screen. Pages for a color reader can also try colored ink and colored backgrounds; everywhere else it is black on white.
import { INK, PAD, SOFT_INK, drawFitted, drawLine, drawNote, measurer } from '../draw';
import { SANS } from '../fonts';
import { clamp } from '../grid';
import { BOLD, type Measure } from '../text';
import { KIND_LABEL, TYPEFACES, typefaceById, type Typeface } from '../typefaces';
import type { WidgetDef } from './types';

const WEIGHTS = { regular: 400, medium: 500, semibold: 600, bold: 700 } as const;
const WEIGHT_OPTIONS = [{ value: 'regular', label: 'Regular' }, { value: 'medium', label: 'Medium' }, { value: 'semibold', label: 'Semibold' }, { value: 'bold', label: 'Bold' }];

/** dark, saturated inks: a color e-ink screen washes colors out, so pale ones would vanish */
export const INKS = ['#000000', '#b3001b', '#0a4fb3', '#13722f', '#6a2fb0', '#b85400'];
/** light backgrounds; on a gray page they are gray levels, on a color page pastels */
export const TINTS_COLOR = ['#ffd9d4', '#d4e6ff', '#d6f2d0', '#fff0b8', '#e5d9ff'];
export const TINTS_GRAY = ['#f0f0f0', '#dedede', '#cccccc'];

export const LAYOUT = { gutter: 58, labelSize: 20, headSize: 24, blockGap: 16, columnGap: 36, lineFactor: 1.22 } as const;

/** "16, 20 26;34" -> [16, 20, 26, 34]: sizes between 8 and 400 px, at most 14 of them, each once, in the order given */
export function parseSizes(text: string): number[] {
  const out: number[] = [];
  for (const part of text.split(/[\s,;]+/)) {
    const n = Math.round(Number(part));
    if (part && Number.isFinite(n) && n >= 8 && n <= 400 && !out.includes(n)) out.push(n);
  }
  return out.slice(0, 14);
}

/** The sample repeated, word by word, for as long as it fits in `room` px (never cut in the middle of a word). */
export function fillLine(sample: string, room: number, size: number, weight: number, measure: Measure): string {
  const words = sample.split(' ').filter(Boolean);
  if (!words.length) return '';
  let text = '';
  for (let i = 0; i < 600; i++) {
    const next = text ? `${text} ${words[i % words.length]}` : words[0];
    if (measure(next, weight, size) > room) break;
    text = next;
  }
  return text;
}

export type SpecimenItem =
  | { kind: 'head'; face: Typeface; x: number; y: number; w: number; h: number }
  | { kind: 'line'; face: Typeface; size: number; step: number; x: number; y: number; w: number; h: number };

/**
 * Where everything goes. A typeface is a block (its name, then one line per size) kept together: when the next block does not fit
 * under the current one it starts the next column, and when there is no column left the rest is counted in `hidden`.
 */
export function planSpecimen(o: { w: number; h: number; faces: Typeface[]; sizes: number[]; columns: number; labels: boolean }): { items: SpecimenItem[]; hidden: number } {
  const cols = clamp(Math.round(o.columns), 1, 3);
  const colW = (o.w - PAD * 2 - (cols - 1) * LAYOUT.columnGap) / cols;
  const bottom = o.h - PAD;
  const headH = o.labels ? Math.round(LAYOUT.headSize * 1.3) : 0;
  const lineH = o.sizes.map((s) => Math.round(s * LAYOUT.lineFactor));
  const blockH = headH + lineH.reduce((a, b) => a + b, 0);

  const items: SpecimenItem[] = [];
  let col = 0;
  let y = PAD;
  let hidden = 0;
  for (let i = 0; i < o.faces.length; i++) {
    const face = o.faces[i];
    if (y + blockH > bottom && y > PAD) { col++; y = PAD; }
    if (col >= cols) { hidden = o.faces.length - i; break; }
    const x = PAD + col * (colW + LAYOUT.columnGap);
    if (o.labels) { items.push({ kind: 'head', face, x, y, w: colW, h: headH }); y += headH; }
    for (let s = 0; s < o.sizes.length; s++) {
      if (y + lineH[s] > bottom) break;
      items.push({ kind: 'line', face, size: o.sizes[s], step: s, x, y, w: colW, h: lineH[s] });
      y += lineH[s];
    }
    y += LAYOUT.blockGap;
  }
  return { items, hidden };
}

const facesOf = (ids: string[]): Typeface[] => ids.flatMap((id) => typefaceById(id) ?? []);

export const specimenWidget: WidgetDef<'specimen'> = {
  type: 'specimen',
  label: 'Type specimen',
  icon: 'type',
  blurb: 'One sample in many typefaces and sizes',
  size: { w: 31, h: 42, minW: 6, minH: 4 },
  defaults: () => ({
    fonts: ['inter', 'literata', 'merriweather', 'lora'],
    sizes: '16, 20, 26, 34, 44',
    sample: 'Sphinx of black quartz, judge my vow. 0123456789',
    fill: true,
    weight: 'regular',
    columns: 1,
    labels: true,
    ink: 'black',
    backdrop: 'none',
    border: false,
  }),
  normalize: (p) => ({ ...p, columns: clamp(Math.round(p.columns), 1, 3), fonts: p.fonts.filter((id) => typeof id === 'string') }),
  fields: [
    { kind: 'multi', key: 'fonts', label: 'Typefaces', options: TYPEFACES.map((t) => ({ value: t.id, label: `${t.name}  (${KIND_LABEL[t.kind].toLowerCase()})` })) },
    { kind: 'text', key: 'sizes', label: 'Sizes', placeholder: '16, 20, 26, 34, 44', mono: true, hint: 'In page pixels, separated by commas. A reader draws about 150 of them to the inch.' },
    { kind: 'area', key: 'sample', label: 'Sample text', rows: 3 },
    { kind: 'switch', key: 'fill', label: 'Repeat the sample to fill each line' },
    { kind: 'select', key: 'weight', label: 'Weight', options: WEIGHT_OPTIONS },
    { kind: 'number', key: 'columns', label: 'Columns', min: 1, max: 3 },
    { kind: 'switch', key: 'labels', label: 'Names and sizes' },
    { kind: 'seg', key: 'ink', label: 'Ink', options: [{ value: 'black', label: 'Black' }, { value: 'color', label: 'Colors' }], hint: 'Colors need "Color" in the dashboard\'s publishing settings.' },
    { kind: 'seg', key: 'backdrop', label: 'Background', options: [{ value: 'none', label: 'White' }, { value: 'tint', label: 'Tinted' }] },
    { kind: 'switch', key: 'border', label: 'Border' },
  ],
  fonts: (p) => facesOf(p.fonts).map((f) => ({ family: f.family, weight: WEIGHTS[p.weight], text: p.sample + p.sizes })),
  draw({ g, w, h, props: p, env }) {
    const faces = facesOf(p.fonts);
    const sizes = parseSizes(p.sizes);
    if (!faces.length) return drawNote(g, w, h, 'Pick some typefaces');
    if (!sizes.length) return drawNote(g, w, h, 'Set the sizes', 'For example 16, 20, 26, 34');
    const sample = p.sample.replace(/\s+/g, ' ').trim() || 'Sphinx of black quartz, judge my vow.';
    const weight = WEIGHTS[p.weight];
    const { items, hidden } = planSpecimen({ w, h, faces, sizes, columns: p.columns, labels: p.labels });
    const gutter = p.labels ? LAYOUT.gutter : 0;

    for (const it of items) {
      const cy = it.y + it.h / 2;
      if (it.kind === 'head') {
        drawFitted(g, `${it.face.name}  ·  ${KIND_LABEL[it.face.kind]}  ·  ${weight}`, it.x, cy, it.w, { size: LAYOUT.headSize, weight: BOLD, family: SANS });
        continue;
      }
      if (p.backdrop === 'tint') {
        const tints = env.color ? TINTS_COLOR : TINTS_GRAY;
        g.fillStyle = tints[it.step % tints.length];
        g.fillRect(it.x, it.y, it.w, it.h);
      }
      if (p.labels) drawLine(g, String(it.size), it.x + gutter - 12, cy, { size: LAYOUT.labelSize, weight: 500, align: 'right', color: SOFT_INK, family: SANS });
      const ink = p.ink === 'color' && env.color ? INKS[it.step % INKS.length] : INK;
      const room = it.w - gutter;
      const own = { size: it.size, weight, family: it.face.family, color: ink };
      const filled = p.fill ? fillLine(sample, room, it.size, weight, measurer(g, it.face.family)) : '';
      // a sample that is wider than the line even once is cut with an ellipsis like any other text
      if (filled) drawLine(g, filled, it.x + gutter, cy, own);
      else drawFitted(g, sample, it.x + gutter, cy, room, own);
    }
    if (hidden > 0) drawLine(g, `+ ${hidden} more`, w - PAD, h - PAD - 10, { size: LAYOUT.labelSize, align: 'right', color: SOFT_INK, family: SANS });
  },
};
