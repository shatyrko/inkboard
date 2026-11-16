// Mock handlers for dashboards, system stats, fetch/run and publishing. (Owned by the dashboard builder.)
// Dashboards live in memory and in localStorage, so they survive a reload of the browser preview.
import { defaultFolder } from '../dashboard/publish-target';
import type { DashboardSummary, PublishMeta, PublishResult, SystemStats } from '../lib/types';
import { handlers as device, showOnMockReader } from './device';
import { addMockFile } from './mtp';

type Doc = { id: string; name: string; updated?: string; [k: string]: unknown };

const STORAGE_KEY = 'inkboard.mock.dashboards';

function restore(): Map<string, Doc> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return new Map((raw ? (JSON.parse(raw) as Doc[]) : []).map((d) => [d.id, d]));
  } catch {
    return new Map();
  }
}
const docs = restore();

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...docs.values()])); } catch { /* storage can be unavailable or full */ }
}

// ---------- invented machine stats that drift a little between calls ----------
let cpu = 23;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const jitter = (spread: number) => (Math.random() - 0.5) * spread;
const started = Date.now() - (3 * 86_400 + 5 * 3600 + 17 * 60) * 1000;

function systemStats(): SystemStats {
  cpu = clamp(cpu + jitter(16), 3, 96);
  return {
    cpuPercent: cpu,
    memUsed: 6.1e9 + jitter(4e8),
    memTotal: 16e9,
    swapUsed: 3e8 + jitter(1e8),
    swapTotal: 4e9,
    uptimeSecs: Math.floor((Date.now() - started) / 1000),
    load: [clamp(cpu / 40 + jitter(0.3), 0.05, 8), 0.74, 0.61],
    disks: [{ mount: '/', total: 512e9, available: 188e9 + jitter(2e9) }, { mount: '/boot', total: 1e9, available: 7.5e8 }],
    battery: { level: clamp(71 + jitter(2), 1, 100), charging: false },
    os: 'Linux',
    hostname: 'workstation',
  };
}

const sampleSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5f7ca8"/><stop offset="1" stop-color="#f1e4cf"/></linearGradient>
<linearGradient id="hill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a97a8"/><stop offset="1" stop-color="#46546a"/></linearGradient>
</defs>
<rect width="480" height="360" fill="url(#sky)"/><circle cx="360" cy="96" r="44" fill="#fbe9b0"/>
<path d="M0 300 L120 170 L210 260 L300 150 L480 300 Z" fill="url(#hill)"/><path d="M0 360 V300 H480 V360 Z" fill="#2c3646"/></svg>`;

/** the first published page (8-bit gray) as a PNG data URL the size of the mock reader's screen, like a real screenshot of it */
function grayPagePng(pixels: Uint8Array, width: number, height: number): string {
  const full = document.createElement('canvas');
  full.width = width;
  full.height = height;
  const rgba = new ImageData(width, height);
  for (let i = 0; i < width * height; i++) {
    const v = pixels[i];
    rgba.data[i * 4] = rgba.data[i * 4 + 1] = rgba.data[i * 4 + 2] = v;
    rgba.data[i * 4 + 3] = 255;
  }
  full.getContext('2d')!.putImageData(rgba, 0, 0);
  const small = document.createElement('canvas');
  small.width = 825;
  small.height = Math.round((825 * height) / width);
  const g = small.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(full, 0, 0, small.width, small.height);
  return small.toDataURL('image/png');
}

/** a push to a USB reader writes files into its folder, which then show up in the mock reader's file manager */
function saveToUsb(meta: PublishMeta, pixels: Uint8Array): PublishResult {
  const target = meta.target;
  if (target?.kind !== 'mtp') throw 'not a USB target';
  const folder = target.folder || defaultFolder(target.format);
  const pages = meta.pages.length;
  if (target.format === 'pdf') {
    const name = `${meta.name}.pdf`;
    const bytes = Math.max(20_000, Math.round(pixels.length / 40));
    addMockFile(target.readerId, folder, name, bytes);
    return { path: `${folder}/${name}`, entryId: '', pages, bytes };
  }
  // png and pen template: one PNG per page, "Name.png" for a single page, "Name - 1.png", "Name - 2.png" ... for several
  const each = Math.max(20_000, Math.round(pixels.length / Math.max(1, pages) / 12));
  const names = pages === 1 ? [`${meta.name}.png`] : meta.pages.map((_, i) => `${meta.name} - ${i + 1}.png`);
  for (const name of names) addMockFile(target.readerId, folder, name, each);
  return { path: pages === 1 ? `${folder}/${names[0]}` : folder, entryId: '', pages, bytes: each * pages };
}

export const handlers: Record<string, (a: any) => unknown> = {
  dashboards_list: (): DashboardSummary[] =>
    [...docs.values()].map((d) => ({ id: d.id, name: d.name, updated: d.updated ?? new Date().toISOString() })),

  dashboards_load: ({ id }: { id: string }) => {
    const d = docs.get(id);
    if (!d) throw `Dashboard not found: ${id}`;
    return structuredClone(d);
  },

  dashboards_save: ({ doc }: { doc: Doc }) => {
    docs.set(doc.id, structuredClone(doc));
    persist();
  },

  dashboards_delete: ({ id }: { id: string }) => {
    docs.delete(id);
    persist();
  },

  system_stats: systemStats,

  fetch_text: ({ url }: { url: string }) => {
    if (/\.txt($|\?)/.test(url)) return 'Rain easing by noon.\nHigh of 19 degrees.\nLight wind from the west.';
    return JSON.stringify({ city: 'Springfield', temp: 18.4, wind: { speed: 12, unit: 'km/h' }, items: [{ name: 'alpha', count: 3 }, { name: 'beta', count: 7 }], updated: '2025-03-03T09:00:00Z' });
  },

  run_command: ({ command }: { command: string }) => {
    if (!(device.settings_get({}) as { allowCommands: boolean }).allowCommands) throw 'Commands are disabled in Settings';
    return `$ ${command}\nup 3 days, 5 hours, 17 minutes\n\nFilesystem      Size  Used Avail Use%\n/dev/nvme0n1p2  477G  289G  188G  61%\n`;
  },

  read_image: () => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sampleSvg)}`,

  dashboard_publish: ({ meta, pixels }: { meta: PublishMeta; pixels: Uint8Array }): PublishResult => {
    if (meta.target?.kind === 'mtp') return saveToUsb(meta, pixels);
    const first = meta.pages[0];
    if (meta.display && first) showOnMockReader(grayPagePng(pixels, first.width, first.height));
    return {
      path: `${meta.folder || 'Document/Dashboards'}/${meta.name}.pdf`,
      entryId: 'mock-entry',
      pages: meta.pages.length,
      bytes: Math.max(20_000, Math.round(pixels.length / 40)),
    };
  },

  // the browser build has no file dialog, so the UI never gets as far as asking for this; kept for parity with the desktop commands
  dashboard_export_pdf: () => undefined,
};
