// Mock handlers for connection, status, settings and the library: the reader as a small in-memory fake, so the
// whole UI can be driven in a plain browser. Invented data only; nothing here talks to a real device.
//
// URL switches (read once at load):
//   (none)          nothing is paired: the connect flow shows. PIN 12345678 pairs successfully, any other PIN fails
//   ?mock=paired    the Digital Paper (paired, connected) and the USB reader (plugged in)
//   ?mock=dpt       only the Digital Paper
//   ?mock=mtp       only the USB reader; the Digital Paper is not paired
//   ?mock=unplugged both known, the USB reader not connected (mock/mtp.ts can plug it back in)
//   ?mock=offline   Digital Paper paired, but it never answers (for the reconnect state)
//   ?mock=legacy    nothing paired, but keys from dpt-rp1-py are "found"
//   ?mock=big       Digital Paper only, with about two thousand extra documents
import type {
  AppSettings, ConfigKey, ConnectionState, DeviceConfig, DeviceStatus, DiscoveredDevice, Entry, ProbeResult, Reader, TemplateEntry,
  UploadResult, WifiConnectRequest, WifiNetwork, WifiScanResult,
} from '../lib/types';
import { ROOT_ID, bigLibrary, documentEntry, folderEntry, newId, seedLibrary } from './device-data';
import { mockScreenshot } from './device-screen';
import { mode } from './mode';
import { usbReader } from './mtp';
import { simulateTransfer, sleep } from './transfer';

// what the fake reader shows once a dashboard was pushed to it with "open on the reader" (set by mock/dashboards.ts);
// until then it shows the book page
let pushed: string | null = null;
export function showOnMockReader(png: string) { pushed = png; }

// 192.0.2.0/24 is reserved for documentation: these addresses never belong to a real network
const READERS: DiscoveredDevice[] = [
  { addr: '192.0.2.41', port: 8443, name: 'DPT-RP1', serial: 'DEMO-0001234', model: 'DPT-RP1' },
  { addr: '192.0.2.57', port: 8443, name: 'DPT-RP1', serial: 'DEMO-0005678', model: 'DPT-RP1' },
];
const UNKNOWN_SERIAL = 'DEMO-0009999';
const GOOD_PIN = '12345678';

// ---------- connection ----------
const forgotten = (): ConnectionState => ({ configured: false, addr: null, serial: null, connected: false, legacyCredentials: mode === 'legacy' });
const paired = (addr: string, connected: boolean): ConnectionState => ({
  configured: true, addr, serial: READERS.find((r) => r.addr === addr)?.serial ?? UNKNOWN_SERIAL, connected, legacyCredentials: false,
});

let conn: ConnectionState = forgotten();
if (['paired', 'dpt', 'big', 'unplugged'].includes(mode)) conn = paired(READERS[0].addr, true);
if (mode === 'offline') conn = paired(READERS[0].addr, false);
let pinRequestedFor: string | null = null;

function requireReader() {
  if (!conn.connected) throw 'The reader is not connected.';
}
function requireAnswer(addr: string) {
  if (/offline|\.250$/.test(addr)) throw `No reader answered at ${addr}. Check the address, and that the reader's Wi-Fi is on and on the same network as this computer.`;
}

// ---------- status and settings of the reader ----------
let wifiEnabled = true;
const status = (): DeviceStatus => ({
  model: 'DPT-RP1', serial: conn.serial ?? UNKNOWN_SERIAL, color: 'White', firmware: '1.0.0.0', apiVersion: '2.0',
  battery: { level: 78, pen: 56, status: 'discharging', plugged: 'none', health: 'good', charging: false },
  storage: { capacity: 13_300_000_000, available: 4_900_000_000 },
  wifiEnabled,
});

let config: DeviceConfig = { dateFormat: 'yyyy/M/d', timeFormat: '24hour', timeoutToStandby: '10', timezone: 'Europe/Berlin', owner: 'Demo Reader' };
const CONFIG_FIELD: Record<ConfigKey, keyof DeviceConfig> = {
  date_format: 'dateFormat', time_format: 'timeFormat', timeout_to_standby: 'timeoutToStandby', timezone: 'timezone', owner: 'owner',
};

let saved: WifiNetwork[] = [
  { ssid: 'Maple Cafe', security: 'psk', dhcp: true, proxy: false },
  { ssid: 'Studio-2.4', security: 'psk', dhcp: true, proxy: false },
];
const nearby: WifiScanResult[] = [
  { ssid: 'Studio-2.4', security: 'psk', signal: -48 },
  { ssid: 'Maple Cafe', security: 'psk', signal: -63 },
  { ssid: 'Harbor Wi-Fi', security: 'psk', signal: -71 },
  { ssid: 'Open Hotspot', security: 'nonsec', signal: -80 },
];

let settings: AppSettings = { allowCommands: false, dashboardFolder: 'Document/Dashboards', displayAfterPush: true, tapSquares: true };

// ---------- library ----------
let entries: Entry[] = mode === 'big' ? bigLibrary() : seedLibrary();
let templates: TemplateEntry[] = [
  { id: newId(), name: 'Cornell notes.pdf' },
  { id: newId(), name: 'Weekly planner.pdf' },
  { id: newId(), name: 'Dot grid.pdf' },
];

const base = (p: string) => p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1);
const parentOf = (p: string) => p.slice(0, p.lastIndexOf('/'));
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function find(id: string): Entry {
  const e = entries.find((x) => x.id === id);
  if (!e) throw 'That item no longer exists on the reader.';
  return e;
}
const pathOfFolder = (id: string) => (id === ROOT_ID ? 'Document' : find(id).path);
const idOfFolder = (path: string) => (path === 'Document' ? ROOT_ID : entries.find((e) => e.kind === 'folder' && e.path === path)?.id);

/** creates the folder and every missing parent */
function ensureFolder(path: string): string {
  if (path !== 'Document' && !path.startsWith('Document/')) throw 'Everything on the reader lives in the "Document" folder.';
  const known = idOfFolder(path);
  if (known) return known;
  const parentId = ensureFolder(parentOf(path));
  const f = folderEntry(path, parentId);
  entries.push(f);
  return f.id;
}

const fakeSize = (name: string) => 300_000 + [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 9000, 7) * 1000;

function mustBeFreeIn(folderPath: string, name: string, ignoreId?: string) {
  const clash = entries.find((e) => e.id !== ignoreId && parentOf(e.path) === folderPath && e.name.toLowerCase() === name.toLowerCase());
  if (clash) throw `"${name}" already exists in ${folderPath}.`;
}

/** the paired Digital Paper, as the readers list names it */
const dptReader = (): Reader => ({ id: 'dpt', kind: 'digital-paper', name: 'DPT-RP1', maker: 'Sony', connected: conn.connected, link: 'wifi' });

export const handlers: Record<string, (a: any) => unknown> = {
  // ----- readers -----
  readers_list: () => {
    const usb = usbReader();
    return [...(conn.configured ? [dptReader()] : []), ...(usb ? [usb] : [])];
  },

  // ----- connection -----
  connection_state: () => ({ ...conn }),
  discover_devices: async () => {
    await sleep(2200); // a real network scan takes a few seconds
    return READERS.map((r) => ({ ...r }));
  },
  probe_device: async ({ addr }: { addr: string }): Promise<ProbeResult> => {
    await sleep(500);
    requireAnswer(addr);
    return { addr, model: 'DPT-RP1', serial: READERS.find((r) => r.addr === addr)?.serial ?? UNKNOWN_SERIAL, apiVersion: '2.0' };
  },
  pair_start: async ({ addr }: { addr: string }) => {
    await sleep(600);
    requireAnswer(addr);
    pinRequestedFor = addr;
  },
  pair_finish: async ({ pin }: { pin: string }) => {
    await sleep(700);
    if (!pinRequestedFor) throw 'The reader is not showing a PIN. Ask it for a new one first.';
    if (pin !== GOOD_PIN) throw 'Wrong PIN. Check the number on the reader and try again.';
    conn = paired(pinRequestedFor, true);
    pinRequestedFor = null;
    return { ...conn };
  },
  import_legacy_credentials: async ({ addr }: { addr: string }) => {
    await sleep(500);
    if (!conn.legacyCredentials) throw 'No keys from dpt-rp1-py were found on this computer.';
    requireAnswer(addr);
    conn = { ...paired(addr, true), legacyCredentials: true };
    return { ...conn };
  },
  connect: async () => {
    await sleep(500);
    if (!conn.configured) throw 'No reader is paired yet.';
    if (mode === 'offline') throw `The reader at ${conn.addr} did not answer. Is its Wi-Fi switched on?`;
    conn = { ...conn, connected: true };
    return { ...conn };
  },
  forget_device: () => {
    conn = forgotten();
    pinRequestedFor = null;
    return { ...conn };
  },

  // ----- status and settings of the reader -----
  device_status: () => { requireReader(); return status(); },
  device_screenshot: async () => { requireReader(); await sleep(350); return pushed ?? mockScreenshot(); },
  device_config: () => { requireReader(); return { ...config }; },
  device_set_config: async ({ key, value }: { key: ConfigKey; value: string }) => {
    requireReader();
    await sleep(300);
    if (key === 'time_format' && value !== '12hour' && value !== '24hour') throw 'The reader only knows 12hour and 24hour.';
    if (key === 'timezone') {
      try { new Intl.DateTimeFormat('en', { timeZone: value }); } catch { throw `The reader does not know the time zone "${value}".`; }
    }
    config = { ...config, [CONFIG_FIELD[key]]: value };
  },
  device_sync_clock: async () => { requireReader(); await sleep(400); },
  wifi_list: () => { requireReader(); return copy(saved); },
  wifi_scan: async () => { requireReader(); await sleep(1400); return copy(nearby); },
  wifi_connect: async ({ req }: { req: WifiConnectRequest }) => {
    requireReader();
    await sleep(900);
    if (req.security === 'psk' && (req.password.length < 8 || req.password.length > 63)) throw 'The password must have 8 to 63 characters.';
    saved = [...saved.filter((n) => n.ssid !== req.ssid), { ssid: req.ssid, security: req.security, dhcp: req.dhcp, proxy: false }];
  },
  wifi_forget: ({ ssid }: { ssid: string }) => { requireReader(); saved = saved.filter((n) => n.ssid !== ssid); },
  wifi_set_enabled: async ({ enabled }: { enabled: boolean }) => { requireReader(); await sleep(300); wifiEnabled = enabled; },

  // ----- library -----
  library_list: async () => { requireReader(); await sleep(150); return copy(entries); },
  library_upload: async ({ paths, folder }: { paths: string[]; folder: string }): Promise<UploadResult[]> => {
    requireReader();
    const folderId = ensureFolder(folder);
    const out: UploadResult[] = [];
    for (const p of paths) {
      const name = base(p);
      if (!/\.pdf$/i.test(name)) { out.push({ name, ok: false, error: 'Only PDF files can be uploaded.' }); continue; }
      const size = fakeSize(name);
      await simulateTransfer(name, 'up', size);
      const path = `${folder}/${name}`;
      // an upload under an existing name replaces it
      entries = entries.filter((e) => e.path !== path);
      entries.push(documentEntry(path, folderId, { name, pages: 5 + (size % 230), mb: size / 1_000_000, modified: 0, isNew: true }));
      out.push({ name, ok: true, error: null });
    }
    return out;
  },
  library_add_tap_squares: async ({ entryId }: { entryId: string }): Promise<UploadResult> => {
    requireReader();
    const e = find(entryId);
    if (e.docType === 'note') throw 'Notes cannot be changed.';
    await simulateTransfer(e.name, 'down', e.size);
    const name = `${e.name.replace(/\.pdf$/i, '').replace(/ \(tap squares\)$/, '')} (tap squares).pdf`;
    const path = `${e.path.slice(0, e.path.lastIndexOf('/'))}/${name}`;
    await simulateTransfer(name, 'up', e.size);
    entries = entries.filter((x) => x.path !== path);
    entries.push(documentEntry(path, e.parentId, { name, pages: e.totalPage, mb: e.size / 1_000_000, modified: 0, isNew: true }));
    return { name, ok: true, error: null };
  },
  library_download: async ({ entryId }: { entryId: string }) => {
    requireReader();
    const e = find(entryId);
    await simulateTransfer(e.name, 'down', e.size);
  },
  library_delete: ({ entryId, kind }: { entryId: string; kind: 'document' | 'folder' }) => {
    requireReader();
    const e = find(entryId);
    if (e.kind !== kind) throw `That item is not a ${kind}.`;
    if (kind === 'folder' && entries.some((x) => x.parentId === e.id)) throw 'The folder is not empty.';
    entries = entries.filter((x) => x.id !== e.id);
  },
  library_new_folder: ({ path }: { path: string }) => {
    requireReader();
    if (idOfFolder(path)) throw 'A folder with this name already exists.';
    ensureFolder(path);
  },
  library_move: ({ entryId, folderId, newName }: { entryId: string; folderId: string; newName: string | null }) => {
    requireReader();
    const e = find(entryId);
    const dir = pathOfFolder(folderId);
    const name = newName ?? e.name;
    mustBeFreeIn(dir, name, e.id);
    e.name = name;
    e.parentId = folderId;
    e.path = `${dir}/${name}`;
  },
  library_copy: ({ entryId, folderId, newName }: { entryId: string; folderId: string; newName: string | null }) => {
    requireReader();
    const e = find(entryId);
    const dir = pathOfFolder(folderId);
    const name = newName ?? e.name;
    mustBeFreeIn(dir, name);
    entries.push({ ...e, id: newId(), name, parentId: folderId, path: `${dir}/${name}`, isNew: true });
  },
  library_open: async ({ entryId }: { entryId: string }) => { requireReader(); find(entryId); await sleep(250); },
  templates_list: () => { requireReader(); return copy(templates); },
  templates_upload: ({ path }: { path: string }) => {
    requireReader();
    const name = base(path);
    if (!/\.pdf$/i.test(name)) throw 'Templates must be PDF files.';
    templates = [...templates.filter((t) => t.name !== name), { id: newId(), name }];
  },
  templates_delete: ({ id }: { id: string }) => { requireReader(); templates = templates.filter((t) => t.id !== id); },

  // ----- app settings -----
  settings_get: () => ({ ...settings }),
  settings_set: ({ patch }: { patch: Partial<AppSettings> }) => {
    settings = { ...settings, ...patch };
    return { ...settings };
  },
};
