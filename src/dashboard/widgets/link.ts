import { INK, PAD, PAPER, drawFitted, roundRect } from '../draw';
import { clamp } from '../grid';
import { resolveTarget } from '../targets';
import { BOLD, fitFontSize } from '../text';
import type { WidgetDef } from './types';

export const linkWidget: WidgetDef<'link'> = {
  type: 'link',
  label: 'Page link',
  icon: 'link',
  blurb: 'A button that jumps to another page',
  size: { w: 9, h: 3, minW: 3, minH: 2 },
  defaults: () => ({ label: 'Next page', target: 'next', look: 'outline', size: 40 }),
  normalize: (p) => ({ ...p, size: clamp(Math.round(p.size), 20, 120) }),
  fields: [
    { kind: 'text', key: 'label', label: 'Label' },
    { kind: 'target', key: 'target', label: 'Goes to' },
    { kind: 'seg', key: 'look', label: 'Look', options: [{ value: 'outline', label: 'Outline' }, { value: 'solid', label: 'Solid' }] },
    { kind: 'number', key: 'size', label: 'Text size', min: 20, max: 120, step: 2, unit: 'px' },
  ],
  draw({ g, w, h, props: p, env, measure }) {
    const solid = p.look === 'solid';
    const broken = resolveTarget(p.target, env.pages, env.pageIndex) === null;
    g.lineWidth = 4;
    g.strokeStyle = INK;
    // a link that goes nowhere is dashed, so it is noticed in the editor
    g.setLineDash(broken ? [14, 10] : []);
    roundRect(g, 2, 2, w - 4, h - 4, Math.min(28, h / 2));
    if (solid) { g.fillStyle = INK; g.fill(); }
    g.stroke();
    g.setLineDash([]);
    const label = p.label || 'Link';
    const size = fitFontSize(label, BOLD, w - PAD * 2, h - PAD, measure, { min: 20, max: p.size });
    drawFitted(g, label, w / 2, h / 2, w - PAD * 2, { size, weight: BOLD, align: 'center', color: solid ? PAPER : INK });
  },
  links: ({ rect, props, pages, pageIndex }) => {
    const to = resolveTarget(props.target, pages, pageIndex);
    return to === null ? [] : [{ ...rect, page: to + 1 }];
  },
};
