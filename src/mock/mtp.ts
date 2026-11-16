// Mock of a USB reader (MTP) for browser-only development: an invented Android e-reader with an in-memory file tree that
// upload, rename, move, delete and new folder really change. Nothing here talks to a real device.
// Which readers exist depends on ?mock= (see mock/device.ts): paired and mtp plug it in, unplugged knows it but leaves it
// disconnected. setMtpPlugged() flips that at run time. The dashboard builder calls addMockFile.
// USB debugging (ADB): by default it is off on this side and connecting succeeds after a few seconds, as if the user tapped Allow;
//   ?mock=adb     USB reader only, USB debugging already connected
//   ?mock=noadb   USB reader only, USB debugging is off on the reader (connecting fails)
// From the browser console: mockUsb.plug(), unplug(), adb('ready' | 'off' | 'unavailable'), denyNext() (the next connect is refused).
import type { AdbState, AdbStatus, MtpEntry, MtpStatus, Reader, UploadResult } from '../lib/types';
import { mockScreenshot } from './device-screen';
import { mode } from './mode';
import { simulateTransfer, sleep } from './transfer';

export const MTP_ID = 'mtp:3f9a1c52';
const STORAGE = 65537;
const TOTAL = 116_000_000_000;
/** system, apps and media the mock does not list, so the storage meter is not empty */
const BASE_USED = 31_400_000_000;

let known = ['paired', 'mtp', 'unplugged', 'adb', 'noadb'].includes(mode);
let plugged = ['paired', 'mtp', 'adb', 'noadb'].includes(mode);
let adbState: AdbState = mode === 'adb' ? 'ready' : mode === 'noadb' ? 'unavailable' : 'off';
let deny = false;

/** plugging in a reader that was not there at all makes it appear, as a real one does */
export function setMtpPlugged(on: boolean): void {
  plugged = on;
  if (on) known = true;
}

/** the reader as the readers list shows it, or null while this mock run has no USB reader */
export function usbReader(): Reader | null {
  return known ? { id: MTP_ID, kind: 'mtp', name: 'Tab X C', maker: 'ONYX', connected: plugged, link: 'usb' } : null;
}

// from the browser console, see the top of this file
Object.assign(window, {
  mockUsb: {
    plug: () => setMtpPlugged(true),
    unplug: () => setMtpPlugged(false),
    adb: (state: AdbState) => { adbState = state; },
    denyNext: () => { deny = true; },
  },
});

type Node = MtpEntry & { parent: number | null };
let handles = 1000;
const newHandle = () => ++handles;
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
let nodes: Node[] = [];

const ROOT_FOLDERS = [
  'Alarms', 'Android', 'Audiobooks', 'Backups', 'Books', 'Comics', 'DCIM', 'Dictionaries', 'Documents', 'Download', 'Fonts', 'Movies',
  'Music', 'Notes', 'noteTemplate', 'Notifications', 'Pictures', 'Podcasts', 'Recordings', 'Ringtones', 'Scans', 'Screenshots', 'Sketches', 'Wallpapers',
];

/** [name, megabytes, days since it was changed] */
const FILES: Record<string, [string, number, number][]> = {
  Books: [
    ['The Lighthouse Almanac.epub', 1.8, 30], ['Тихая гавань.fb2', 0.9, 45], ['A Short History of Clocks.pdf', 12.6, 90],
    ['Café Culture in Vienna.mobi', 2.4, 75], ['Field Notes on Lichens.pdf', 1.8, 14], ['Müller - Thermodynamics (draft).pdf', 3.3, 5],
  ],
  'Books/Fiction': [['Дорога на север.epub', 1.1, 200], ['Сад камней.epub', 0.9, 120], ['Ёлка и ёж.fb2', 0.3, 60]],
  'Books/Poetry': [['Зимние строки.epub', 0.5, 140], ['Ночные огни.epub', 0.6, 30]],
  Comics: [['Harbour Stories 01.cbz', 48, 20]],
  Documents: [['Quick start guide.pdf', 1.4, 400], ['Meeting notes - March.pdf', 0.3, 220], ['Квартальный отчёт.pdf', 1.2, 20]],
  'Documents/Dashboards': [['Morning overview.pdf', 0.1, 0], ['Week ahead.png', 0.3, 1]],
  Download: [['receipt-2026-03.pdf', 0.2, 8], ['wallpaper-dusk.jpg', 2.2, 40], ['update-notes.txt', 0.01, 3]],
  Pictures: [['IMG_0412.jpg', 3.1, 10], ['IMG_0413.jpg', 2.9, 10]],
  Notes: [['Sketch - kitchen shelves.note', 0.4, 11], ['Идеи для проекта.note', 0.6, 2]],
  Fonts: [['Harbor Serif.ttf', 0.4, 300]],
  'Android/data': [],
  'Android/media': [],
  'Android/obb': [],
};

function seed(): Node[] {
  nodes = [];
  const folder = (parent: number | null, name: string): number => {
    const h = newHandle();
    nodes.push({ handle: h, parent, name, kind: 'folder', size: 0, modified: daysAgo(30) });
    return h;
  };
  const pathHandle = (path: string): number => {
    let parent: number | null = null;
    for (const seg of path.split('/')) {
      parent = nodes.find((n) => n.parent === parent && n.kind === 'folder' && n.name === seg)?.handle ?? folder(parent, seg);
    }
    return parent as number;
  };
  for (const name of ROOT_FOLDERS) folder(null, name);
  for (const [path, files] of Object.entries(FILES)) {
    const parent = pathHandle(path);
    for (const [name, mb, ago] of files) nodes.push({ handle: newHandle(), parent, name, kind: 'file', size: Math.round(mb * 1_000_000), modified: daysAgo(ago) });
  }
  return nodes;
}
seed();

const base = (p: string) => p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1);
const used = () => BASE_USED + nodes.reduce((n, x) => n + x.size, 0);

function requireUsb(id: string) {
  if (id !== MTP_ID) throw 'No such USB reader.';
  if (!plugged) throw 'The USB reader is not connected. Check the cable and that the reader is unlocked.';
}
function node(handle: number): Node {
  const n = byHandle(handle);
  if (!n) throw 'That item no longer exists on the reader.';
  return n;
}
const kids = (parent: number | null) => nodes.filter((n) => n.parent === parent);
function mustBeFree(parent: number | null, name: string, ignore?: number) {
  if (kids(parent).some((n) => n.handle !== ignore && n.name.toLowerCase() === name.toLowerCase())) throw `"${name}" already exists in that folder.`;
}
const byHandle = (handle: number | null) => nodes.find((x) => x.handle === handle);
/** true for the folder itself and for anything below it */
function isInside(handle: number, ancestor: number): boolean {
  for (let n = byHandle(handle); n; n = byHandle(n.parent)) if (n.handle === ancestor) return true;
  return false;
}
/** creates the folders of a path below the storage root and returns the last one's handle (null for an empty path) */
function ensurePath(path: string): number | null {
  let parent: number | null = null;
  for (const seg of path.split('/').filter(Boolean)) {
    const found: Node | undefined = kids(parent).find((n) => n.kind === 'folder' && n.name === seg);
    if (found) { parent = found.handle; continue; }
    const h = newHandle();
    nodes.push({ handle: h, parent, name: seg, kind: 'folder', size: 0, modified: new Date().toISOString() });
    parent = h;
  }
  return parent;
}
/** an upload under an existing name replaces that file */
function putFile(parent: number | null, name: string, bytes: number) {
  nodes = nodes.filter((n) => !(n.parent === parent && n.kind === 'file' && n.name.toLowerCase() === name.toLowerCase()));
  nodes.push({ handle: newHandle(), parent, name, kind: 'file', size: bytes, modified: new Date().toISOString() });
}
const fakeSize = (name: string) => 200_000 + [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 9000, 7) * 1000;
const strip = ({ handle, name, kind, size, modified }: Node): MtpEntry => ({ handle, name, kind, size, modified });

function requireAdb(id: string) {
  requireUsb(id);
  if (adbState !== 'ready') throw 'USB debugging is not connected. Turn it on first.';
}
const adbStatus = (): AdbStatus => adbState === 'ready'
  ? { state: 'ready', android: '13', battery: { level: 87, charging: false }, screen: { width: 1650, height: 2200 } }
  : { state: adbState, android: null, battery: null, screen: null };
/** the file or folder at a path relative to the storage root, or null */
function atPath(path: string): Node | null {
  let parent: number | null = null;
  let found: Node | null = null;
  for (const seg of path.split('/').filter(Boolean)) {
    found = kids(parent).find((n) => n.name === seg) ?? null;
    if (!found) return null;
    parent = found.handle;
  }
  return found;
}

/** Puts a file into the mock USB reader's folder (creating folders), as publishing a dashboard to it would. */
export function addMockFile(readerId: string, folderPath: string, name: string, bytes: number): void {
  requireUsb(readerId);
  putFile(ensurePath(folderPath), name, bytes);
}

export const handlers: Record<string, (a: any) => unknown> = {
  mtp_status: async ({ id }: { id: string }): Promise<MtpStatus> => {
    requireUsb(id);
    await sleep(100);
    return {
      id, maker: 'ONYX', model: 'TabXC', name: 'Tab X C',
      storages: [{ id: STORAGE, name: 'Internal shared storage', total: TOTAL, free: TOTAL - used() }],
      usbSpeed: 'High speed (480 Mbit/s)',
    };
  },
  mtp_list: async ({ id, parent }: { id: string; parent: number | null }): Promise<MtpEntry[]> => {
    requireUsb(id);
    await sleep(120);
    return kids(parent).map(strip);
  },
  mtp_upload: async ({ id, parent, paths }: { id: string; parent: number | null; paths: string[] }): Promise<UploadResult[]> => {
    requireUsb(id);
    const out: UploadResult[] = [];
    for (const p of paths) {
      const name = base(p);
      const size = fakeSize(name);
      await simulateTransfer(name, 'up', size);
      putFile(parent, name, size);
      out.push({ name, ok: true, error: null });
    }
    return out;
  },
  mtp_download: async ({ id, handle }: { id: string; handle: number }) => {
    requireUsb(id);
    const n = node(handle);
    if (n.kind === 'folder') throw 'Folders cannot be downloaded.';
    await simulateTransfer(n.name, 'down', n.size);
  },
  adb_status: async ({ id }: { id: string }): Promise<AdbStatus> => {
    requireUsb(id);
    await sleep(150);
    return adbStatus();
  },
  adb_connect: async ({ id }: { id: string }): Promise<AdbStatus> => {
    requireUsb(id);
    if (adbState === 'unavailable') { await sleep(600); throw 'USB debugging is off on the reader. Turn it on in Settings > Developer options > USB debugging, then try again.'; }
    await sleep(2500); // the user reads the prompt and taps Allow
    if (deny) { deny = false; throw 'The reader did not approve this computer. Tap Allow when it asks "Allow USB debugging?", then try again.'; }
    adbState = 'ready';
    return adbStatus();
  },
  adb_disconnect: ({ id }: { id: string }) => {
    requireUsb(id);
    adbState = 'off';
  },
  adb_screenshot: async ({ id }: { id: string }): Promise<string> => {
    requireAdb(id);
    await sleep(400);
    return mockScreenshot();
  },
  adb_open: async ({ id, path }: { id: string; path: string }) => {
    requireAdb(id);
    await sleep(300);
    if (atPath(path)?.kind !== 'file') throw `There is no file "${path}" on the reader.`;
  },
  mtp_delete: ({ id, handle }: { id: string; handle: number }) => {
    requireUsb(id);
    node(handle);
    nodes = nodes.filter((n) => !isInside(n.handle, handle)); // a folder goes with everything in it
  },
  mtp_new_folder: ({ id, parent, name }: { id: string; parent: number | null; name: string }): number => {
    requireUsb(id);
    mustBeFree(parent, name);
    const h = newHandle();
    nodes.push({ handle: h, parent, name, kind: 'folder', size: 0, modified: new Date().toISOString() });
    return h;
  },
  mtp_rename: ({ id, handle, name }: { id: string; handle: number; name: string }) => {
    requireUsb(id);
    const n = node(handle);
    mustBeFree(n.parent, name, n.handle);
    n.name = name;
  },
  mtp_move: ({ id, handle, parent }: { id: string; handle: number; parent: number | null }) => {
    requireUsb(id);
    const n = node(handle);
    if (parent !== null && isInside(parent, handle)) throw 'A folder cannot be moved into itself.';
    mustBeFree(parent, n.name, n.handle);
    n.parent = parent;
  },
};
