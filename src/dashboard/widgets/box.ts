import { FILLS, INK, roundRect } from '../draw';
import { clamp } from '../grid';
import type { WidgetDef } from './types';

export const boxWidget: WidgetDef<'box'> = {
  type: 'box',
  label: 'Box',
  icon: 'square',
  blurb: 'A rectangle, rounded box or line',
  size: { w: 12, h: 6, minW: 1, minH: 1 },
  defaults: () => ({ shape: 'rounded', stroke: 4, fill: 'none', radius: 24 }),
  normalize: (p) => ({ ...p, stroke: clamp(Math.round(p.stroke), 2, 40), radius: clamp(Math.round(p.radius), 0, 300) }),
  fields: [
    { kind: 'seg', key: 'shape', label: 'Shape', options: [{ value: 'rect', label: 'Rectangle' }, { value: 'rounded', label: 'Rounded' }, { value: 'line', label: 'Line' }] },
    { kind: 'number', key: 'stroke', label: 'Line width', min: 2, max: 40, unit: 'px' },
    { kind: 'number', key: 'radius', label: 'Corner radius', min: 0, max: 300, unit: 'px', when: (p) => p.shape === 'rounded' },
    { kind: 'select', key: 'fill', label: 'Fill', when: (p) => p.shape !== 'line', options: [
      { value: 'none', label: 'None' }, { value: 'light', label: 'Light gray' }, { value: 'medium', label: 'Medium gray' },
      { value: 'dark', label: 'Dark gray' }, { value: 'black', label: 'Black' },
    ] },
  ],
  draw({ g, w, h, props: p }) {
    g.strokeStyle = INK;
    g.lineWidth = p.stroke;
    if (p.shape === 'line') {
      // along the longer side, centred on the other
      g.lineCap = 'butt';
      g.beginPath();
      if (w >= h) { g.moveTo(0, h / 2); g.lineTo(w, h / 2); } else { g.moveTo(w / 2, 0); g.lineTo(w / 2, h); }
      g.stroke();
      return;
    }
    const inset = p.stroke / 2;
    roundRect(g, inset, inset, w - p.stroke, h - p.stroke, p.shape === 'rounded' ? p.radius : 0);
    const fill = FILLS[p.fill];
    if (fill) { g.fillStyle = fill; g.fill(); }
    g.stroke();
  },
};
