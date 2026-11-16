import { api } from '../../lib/api';
import { fmtBytes } from '../../lib/format';
import type { DeviceStatus } from '../../lib/types';
import type { ReaderRow } from '../model';
import type { WidgetDef } from './types';
import { drawStats, statsNote, type StatRow } from './stats';

const ROWS: { value: ReaderRow; label: string }[] = [
  { value: 'battery', label: 'Reader battery' }, { value: 'pen', label: 'Pen battery' }, { value: 'storage', label: 'Storage' },
];

export function readerRows(s: DeviceStatus, wanted: ReaderRow[]): StatRow[] {
  const rows: StatRow[] = [];
  for (const { value: key } of ROWS) {
    if (!wanted.includes(key)) continue;
    if (key === 'battery') rows.push({ label: s.battery.charging ? 'Battery (charging)' : 'Battery', value: `${Math.round(s.battery.level)}%`, fraction: s.battery.level / 100 });
    else if (key === 'pen') rows.push({ label: 'Pen', value: `${Math.round(s.battery.pen)}%`, fraction: s.battery.pen / 100 });
    else {
      const used = Math.max(0, s.storage.capacity - s.storage.available);
      rows.push({ label: 'Storage', value: `${fmtBytes(used)} / ${fmtBytes(s.storage.capacity)}`, fraction: s.storage.capacity > 0 ? used / s.storage.capacity : 0 });
    }
  }
  return rows;
}

export const readerWidget: WidgetDef<'reader', DeviceStatus> = {
  type: 'reader',
  label: 'Reader',
  icon: 'device',
  blurb: 'Reader and pen battery, storage',
  size: { w: 31, h: 11, minW: 10, minH: 4 },
  defaults: () => ({ title: 'Reader', rows: ['battery', 'pen', 'storage'], border: false }),
  fields: [
    { kind: 'text', key: 'title', label: 'Title', placeholder: 'No title' },
    { kind: 'multi', key: 'rows', label: 'Show', options: ROWS },
    { kind: 'switch', key: 'border', label: 'Border' },
  ],
  source: () => ({ key: 'reader', kind: 'reader', load: () => api.deviceStatus() }),
  draw({ g, w, h, props, data, measure }) {
    if (statsNote(g, w, h, 'Reader status', data) || !data?.ok) return;
    drawStats(g, w, h, props.title, readerRows(data.value, props.rows), measure);
  },
};
