import { INK, PAD, PAPER, drawFitted, roundRect } from '../draw';
import { clamp } from '../grid';
import { navCells } from '../targets';
import { BOLD, fitFontSize } from '../text';
import type { WidgetDef } from './types';

export const navWidget: WidgetDef<'nav'> = {
  type: 'nav',
  label: 'Page tabs',
  icon: 'rows',
  blurb: 'A tab strip that lists every page',
  size: { w: 31, h: 2, minW: 4, minH: 1 },
  defaults: () => ({ size: 36 }),
  normalize: (p) => ({ ...p, size: clamp(Math.round(p.size), 20, 120) }),
  fields: [{ kind: 'number', key: 'size', label: 'Text size', min: 20, max: 120, step: 2, unit: 'px', hint: 'The tabs are generated from the page names.' }],
  draw({ g, w, h, props, env, measure }) {
    const cells = navCells(w, h, env.pages.length);
    g.save();
    roundRect(g, 2, 2, w - 4, h - 4, Math.min(20, h / 2));
    g.clip();
    cells.forEach((c, i) => {
      const current = i === env.pageIndex;
      if (current) { g.fillStyle = INK; g.fillRect(c.x, c.y, c.w, c.h); }
      else if (i > 0) { g.fillStyle = INK; if (w >= h) g.fillRect(c.x - 1, 0, 3, h); else g.fillRect(0, c.y - 1, w, 3); }
      const name = env.pages[i].name;
      const size = fitFontSize(name, BOLD, c.w - PAD, c.h - 8, measure, { min: 18, max: props.size });
      drawFitted(g, name, c.x + c.w / 2, c.y + c.h / 2, c.w - PAD, { size, weight: BOLD, align: 'center', color: current ? PAPER : INK });
    });
    g.restore();
    g.strokeStyle = INK;
    g.lineWidth = 4;
    roundRect(g, 2, 2, w - 4, h - 4, Math.min(20, h / 2));
    g.stroke();
  },
  links: ({ rect, pages }) => navCells(rect.w, rect.h, pages.length).map((c, i) => ({ x: rect.x + c.x, y: rect.y + c.y, w: c.w, h: c.h, page: i + 1 })),
};
