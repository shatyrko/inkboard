import { INK, PAD, PAPER, SOFT_INK, drawFitted, drawLine, roundRect } from '../draw';
import { BOLD, REGULAR, wrapRuns } from '../text';
import { clamp } from '../grid';
import { newId } from '../ids';
import type { ChecklistItem } from '../model';
import type { WidgetDef } from './types';

const sanitizeItems = (items: unknown[]): ChecklistItem[] =>
  items.flatMap((it) => {
    const r = it as Partial<ChecklistItem> | null;
    return r && typeof r.text === 'string' ? [{ id: typeof r.id === 'string' && r.id ? r.id : newId(), text: r.text, done: r.done === true }] : [];
  });

export const checklistWidget: WidgetDef<'checklist'> = {
  type: 'checklist',
  label: 'Checklist',
  icon: 'checklist',
  blurb: 'Items with checkboxes',
  size: { w: 15, h: 13, minW: 6, minH: 4 },
  defaults: () => ({
    title: 'Today',
    items: [
      { id: newId(), text: 'Water the plants', done: true },
      { id: newId(), text: 'Reply to the landlord', done: false },
      { id: newId(), text: 'Book the dentist', done: false },
    ],
    size: 36,
    border: false,
  }),
  normalize: (p) => ({ ...p, items: sanitizeItems(p.items), size: clamp(Math.round(p.size), 20, 120) }),
  fields: [
    { kind: 'text', key: 'title', label: 'Title', placeholder: 'No title' },
    { kind: 'checklist', key: 'items', label: 'Items' },
    { kind: 'number', key: 'size', label: 'Text size', min: 20, max: 120, step: 2, unit: 'px' },
    { kind: 'switch', key: 'border', label: 'Border' },
  ],
  draw({ g, w, h, props, measure }) {
    const left = PAD, room = w - PAD * 2;
    const size = props.size;
    const box = Math.round(size * 0.82);
    const textX = left + box + Math.round(size * 0.45);
    const gap = Math.round(size * 0.4);
    let y = PAD;

    if (props.title) {
      const ts = Math.round(size * 1.2);
      drawFitted(g, props.title, left, y + ts * 0.65, room, { size: ts, weight: BOLD });
      y += Math.round(ts * 1.3);
      g.fillStyle = INK;
      g.fillRect(left, y, room, 3);
      y += gap + 3;
    }

    const bottom = h - PAD;
    const rowH = Math.round(size * 1.3);
    const moreH = Math.round(size * 0.9);
    for (let i = 0; i < props.items.length; i++) {
      const item = props.items[i];
      const lines = wrapRuns([{ text: item.text || ' ', bold: false }], room - (textX - left), size, REGULAR, measure);
      const height = lines.length * rowH;
      const last = i === props.items.length - 1;
      if (y + height > bottom - (last ? 0 : moreH)) {
        const hidden = props.items.length - i;
        drawLine(g, `+ ${hidden} more`, left, y + moreH / 2, { size: Math.round(size * 0.8), weight: 600, color: SOFT_INK });
        break;
      }
      const boxY = y + (rowH - box) / 2;
      g.strokeStyle = INK;
      g.lineWidth = 4;
      roundRect(g, left + 2, boxY + 2, box - 4, box - 4, 6);
      if (item.done) { g.fillStyle = INK; g.fill(); }
      g.stroke();
      if (item.done) {
        g.strokeStyle = PAPER;
        g.lineWidth = Math.max(4, box * 0.12);
        g.lineCap = 'round';
        g.lineJoin = 'round';
        g.beginPath();
        g.moveTo(left + box * 0.25, boxY + box * 0.52);
        g.lineTo(left + box * 0.43, boxY + box * 0.7);
        g.lineTo(left + box * 0.76, boxY + box * 0.3);
        g.stroke();
      }
      lines.forEach((line, n) => {
        const cy = y + n * rowH + rowH / 2;
        line.runs.forEach((r) => drawLine(g, r.text, textX + r.x, cy, { size, weight: REGULAR, color: item.done ? SOFT_INK : INK }));
        if (item.done && line.width > 0) {
          g.fillStyle = SOFT_INK;
          g.fillRect(textX, cy, line.width, 3);
        }
      });
      y += height + gap;
    }
  },
};
