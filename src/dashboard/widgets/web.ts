import { api } from '../../lib/api';
import { PAD, SOFT_INK, anchorX, drawFitted, drawLayout, drawNote } from '../draw';
import { extractValue } from '../extract';
import { clamp } from '../grid';
import { BOLD, fitFontSize, layoutMarkdown, plainBlocks } from '../text';
import type { WidgetDef } from './types';

const ALIGN = [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }];

export const webWidget: WidgetDef<'web', string> = {
  type: 'web',
  label: 'Web',
  icon: 'globe',
  blurb: 'A value or text from a web address',
  size: { w: 15, h: 8, minW: 4, minH: 2 },
  defaults: () => ({ url: '', path: '', regex: '', prefix: '', suffix: '', caption: '', style: 'value', size: 120, align: 'center', border: false }),
  normalize: (p) => ({ ...p, size: clamp(Math.round(p.size), 16, 400) }),
  fields: [
    { kind: 'text', key: 'url', label: 'Address', placeholder: 'https://example.com/data.json', mono: true, hint: 'Downloaded again on every push.' },
    { kind: 'text', key: 'path', label: 'JSON path', placeholder: 'main.temp or items[0].name', mono: true, hint: 'Optional. Picks one value out of a JSON response.' },
    { kind: 'text', key: 'regex', label: 'Pattern', placeholder: 'e.g. Total: (\\d+)', mono: true, hint: 'Optional. Shows the first group (or the whole match).' },
    { kind: 'text', key: 'prefix', label: 'Before the value', placeholder: 'e.g. $' },
    { kind: 'text', key: 'suffix', label: 'After the value', placeholder: 'e.g. °C' },
    { kind: 'text', key: 'caption', label: 'Caption', placeholder: 'e.g. Temperature' },
    { kind: 'seg', key: 'style', label: 'Show as', options: [{ value: 'value', label: 'Big value' }, { value: 'text', label: 'Text' }] },
    { kind: 'number', key: 'size', label: 'Text size', min: 16, max: 400, step: 4, unit: 'px', hint: 'The largest size a big value may take.' },
    { kind: 'seg', key: 'align', label: 'Align', options: ALIGN },
    { kind: 'switch', key: 'border', label: 'Border' },
  ],
  source: (p) => {
    const url = p.url.trim();
    return url ? { key: `web:${url}`, kind: 'web', load: () => api.fetchText(url) } : null;
  },
  manual: { label: 'Fetch now' },
  draw({ g, w, h, props: p, data, measure }) {
    if (!p.url.trim()) return drawNote(g, w, h, 'Set a web address');
    if (!data) return drawNote(g, w, h, 'Not fetched yet', 'Use Refresh data');
    if (!data.ok) return drawNote(g, w, h, 'Web data unavailable');
    let text: string;
    try { text = p.prefix + extractValue(data.value, p) + p.suffix; } catch { return drawNote(g, w, h, 'Web data unavailable'); }

    const left = PAD, room = w - PAD * 2;
    let top = PAD;
    if (p.caption) {
      drawFitted(g, p.caption, anchorX(p.align, left, room), top + 20, room, { size: 34, weight: BOLD, align: p.align, color: SOFT_INK });
      top += 52;
    }
    const area = { x: left, y: top, w: room, h: h - top - PAD };
    if (p.style === 'text') {
      drawLayout(g, layoutMarkdown(plainBlocks(text), area.w, p.size, measure), area, p.align, 'top');
      return;
    }
    const size = fitFontSize(text, BOLD, area.w, area.h, measure, { min: 20, max: p.size });
    drawFitted(g, text, anchorX(p.align, area.x, area.w), area.y + area.h / 2, area.w, { size, weight: BOLD, align: p.align });
  },
};
