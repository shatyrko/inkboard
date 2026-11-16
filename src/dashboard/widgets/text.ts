import { PAD, drawLayout } from '../draw';
import { layoutMarkdown, parseMarkdown } from '../text';
import { clamp } from '../grid';
import type { WidgetDef } from './types';

export const textWidget: WidgetDef<'text'> = {
  type: 'text',
  label: 'Text',
  icon: 'type',
  blurb: 'Notes with headings and bullets',
  size: { w: 16, h: 9, minW: 2, minH: 1 },
  defaults: () => ({ text: '# Notes\n- First thing\n- Second thing\n\nWrite **anything** here.', size: 36, align: 'left', valign: 'top', border: false }),
  normalize: (p) => ({ ...p, size: clamp(Math.round(p.size), 16, 300) }),
  fields: [
    { kind: 'area', key: 'text', label: 'Text', rows: 7, hint: '# heading, ## subheading, - bullet, **bold**' },
    { kind: 'number', key: 'size', label: 'Text size', min: 16, max: 300, step: 2, unit: 'px' },
    { kind: 'seg', key: 'align', label: 'Align', options: [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }] },
    { kind: 'seg', key: 'valign', label: 'Vertical', options: [{ value: 'top', label: 'Top' }, { value: 'middle', label: 'Middle' }, { value: 'bottom', label: 'Bottom' }] },
    { kind: 'switch', key: 'border', label: 'Border' },
  ],
  draw({ g, w, h, props, measure }) {
    const box = { x: PAD, y: PAD, w: w - PAD * 2, h: h - PAD * 2 };
    const layout = layoutMarkdown(parseMarkdown(props.text), box.w, props.size, measure);
    drawLayout(g, layout, box, props.align, props.valign);
  },
};
