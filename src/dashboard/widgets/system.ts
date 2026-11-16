import { api } from '../../lib/api';
import { fmtBytes, fmtDuration } from '../../lib/format';
import type { SystemStats } from '../../lib/types';
import type { SystemRow } from '../model';
import type { WidgetDef } from './types';
import { drawStats, statsNote, type StatRow } from './stats';

const ROWS: { value: SystemRow; label: string }[] = [
  { value: 'cpu', label: 'Processor' }, { value: 'memory', label: 'Memory' }, { value: 'swap', label: 'Swap' }, { value: 'disk', label: 'Disk' },
  { value: 'battery', label: 'Battery' }, { value: 'uptime', label: 'Uptime' }, { value: 'load', label: 'Load average' },
];

const ratio = (used: number, total: number) => (total > 0 ? used / total : 0);

/** the rows for `wanted`, in the order of the list above (so the layout does not depend on click order) */
export function systemRows(s: SystemStats, wanted: SystemRow[]): StatRow[] {
  const rows: StatRow[] = [];
  for (const { value: key } of ROWS) {
    if (!wanted.includes(key)) continue;
    switch (key) {
      case 'cpu': rows.push({ label: 'CPU', value: `${Math.round(s.cpuPercent)}%`, fraction: s.cpuPercent / 100 }); break;
      case 'memory': rows.push({ label: 'Memory', value: `${fmtBytes(s.memUsed)} / ${fmtBytes(s.memTotal)}`, fraction: ratio(s.memUsed, s.memTotal) }); break;
      case 'swap': rows.push(s.swapTotal > 0
        ? { label: 'Swap', value: `${fmtBytes(s.swapUsed)} / ${fmtBytes(s.swapTotal)}`, fraction: ratio(s.swapUsed, s.swapTotal) }
        : { label: 'Swap', value: 'none' }); break;
      case 'disk': {
        // the root volume, or the biggest one when there is none
        const d = s.disks.find((x) => x.mount === '/') ?? [...s.disks].sort((a, b) => b.total - a.total)[0];
        if (d) rows.push({ label: 'Disk', value: `${fmtBytes(d.total - d.available)} / ${fmtBytes(d.total)}`, fraction: ratio(d.total - d.available, d.total) });
        break;
      }
      case 'battery': rows.push(s.battery
        ? { label: s.battery.charging ? 'Battery (charging)' : 'Battery', value: `${Math.round(s.battery.level)}%`, fraction: s.battery.level / 100 }
        : { label: 'Battery', value: 'none' }); break;
      case 'uptime': rows.push({ label: 'Uptime', value: fmtDuration(s.uptimeSecs) }); break;
      case 'load': rows.push({ label: 'Load', value: s.load.map((n) => n.toFixed(2)).join('  ') }); break;
    }
  }
  return rows;
}

export const systemWidget: WidgetDef<'system', SystemStats> = {
  type: 'system',
  label: 'Computer',
  icon: 'cpu',
  blurb: 'Processor, memory, disk and battery',
  size: { w: 31, h: 18, minW: 10, minH: 5 },
  defaults: () => ({ title: 'This computer', rows: ['cpu', 'memory', 'disk', 'battery', 'uptime'], border: false }),
  fields: [
    { kind: 'text', key: 'title', label: 'Title', placeholder: 'No title' },
    { kind: 'multi', key: 'rows', label: 'Show', options: ROWS },
    { kind: 'switch', key: 'border', label: 'Border' },
  ],
  source: () => ({ key: 'system', kind: 'system', load: () => api.systemStats() }),
  draw({ g, w, h, props, data, measure }) {
    if (statsNote(g, w, h, 'Computer status', data) || !data?.ok) return;
    drawStats(g, w, h, props.title, systemRows(data.value, props.rows), measure);
  },
};
