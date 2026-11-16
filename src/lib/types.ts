// The contract between the UI and the Rust side (src-tauri/src/commands.rs). Every field here is camelCase on the wire.
// Keep this file and the Rust structs in sync; src/mock/ implements the same shapes for browser-only development.

// ---------- connection ----------
export type ConnectionState = {
  /** a reader address and a key pair are saved */
  configured: boolean;
  addr: string | null;
  serial: string | null;
  /** an authenticated session is alive right now */
  connected: boolean;
  /** keys written by dpt-rp1-py (~/.config/dpt) exist and can be imported instead of pairing again */
  legacyCredentials: boolean;
};
export type DiscoveredDevice = { addr: string; port: number; name: string; serial: string | null; model: string | null };
export type ProbeResult = { addr: string; model: string; serial: string; apiVersion: string | null };

// ---------- status ----------
export type Battery = {
  /** 0-100 */
  level: number;
  /** pen battery 0-100 */
  pen: number;
  /** e.g. "charging", "discharging", "full" */
  status: string;
  /** e.g. "usb", "none" */
  plugged: string;
  health: string;
  charging: boolean;
};
export type Storage = { available: number; capacity: number }; // bytes
export type DeviceStatus = {
  model: string;
  serial: string;
  color: string;
  firmware: string;
  apiVersion: string;
  battery: Battery;
  storage: Storage;
  wifiEnabled: boolean;
};

// ---------- settings on the reader ----------
export type ConfigKey = 'date_format' | 'time_format' | 'timeout_to_standby' | 'timezone' | 'owner';
export type DeviceConfig = {
  /** e.g. "M/d/yyyy", "yyyy/M/d", "d/M/yyyy" */
  dateFormat: string;
  /** "12hour" | "24hour" */
  timeFormat: string;
  /** minutes as a string, "0" meaning never (as reported by the device) */
  timeoutToStandby: string;
  /** IANA name, e.g. "Europe/Berlin" */
  timezone: string;
  owner: string;
};
export type WifiNetwork = { ssid: string; security: string; dhcp: boolean; proxy: boolean };
export type WifiScanResult = { ssid: string; security: string; signal: number | null };
export type WifiConnectRequest = { ssid: string; security: 'psk' | 'nonsec'; password: string; dhcp: boolean };

// ---------- library ----------
export type Entry = {
  id: string;
  /** file or folder name as shown on the reader (documents keep their extension) */
  name: string;
  /** full path on the reader, e.g. "Document/Folder/name.pdf" */
  path: string;
  kind: 'document' | 'folder';
  /** "note" for documents made with the pen on the reader, "normal" for books/PDFs; null for folders */
  docType: 'normal' | 'note' | null;
  parentId: string;
  size: number;
  mime: string | null;
  created: string;
  modified: string;
  lastRead: string | null;
  currentPage: number;
  totalPage: number;
  isNew: boolean;
};
export type UploadResult = {
  name: string;
  ok: boolean;
  error: string | null;
  /** something worth saying about a file that did go up, e.g. that tap squares could not be added to it */
  note?: string | null;
};
export type TemplateEntry = { id: string; name: string };
export type TransferProgress = { id: string; name: string; direction: 'up' | 'down'; sent: number; total: number; done: boolean; error: string | null };

// ---------- dashboards ----------
export type DashboardSummary = { id: string; name: string; updated: string };
export type SystemStats = {
  cpuPercent: number;
  memUsed: number;
  memTotal: number;
  swapUsed: number;
  swapTotal: number;
  uptimeSecs: number;
  load: [number, number, number];
  disks: { mount: string; total: number; available: number }[];
  /** the computer's battery, null on a desktop */
  battery: { level: number; charging: boolean } | null;
  os: string;
  hostname: string;
};
export type LinkRect = { x: number; y: number; w: number; h: number; /** 1-based target page */ page: number };
export type PublishPage = { width: number; height: number; links: LinkRect[] };
export type PublishMeta = {
  /** document name on the reader, without extension */
  name: string;
  /** remote folder; empty = the app setting (default "Document/Dashboards") */
  folder: string;
  /** open it on the reader's screen once uploaded */
  display: boolean;
  /** one entry per page; the body carries the 8-bit grayscale pixels of every page, concatenated, row-major */
  pages: PublishPage[];
  /** where to publish; omitted means the paired Digital Paper */
  target?: PublishTarget;
  /** the pixels are R, G, B bytes per pixel instead of one gray byte (a color reader); omitted means gray */
  color?: boolean;
};
export type PublishResult = { path: string; entryId: string; pages: number; bytes: number };

// ---------- app ----------
export type AppSettings = {
  /** dashboards may run shell commands (the "Command" widget); off until the user turns it on */
  allowCommands: boolean;
  /** where dashboards are uploaded on the reader */
  dashboardFolder: string;
  /** open the dashboard on the reader's screen right after uploading it */
  displayAfterPush: boolean;
  /** PDFs uploaded to the Digital Paper get tap squares in the bottom corners, to turn pages with a tap instead of a swipe */
  tapSquares: boolean;
};

// ---------- readers (more than one device) ----------
/** 'digital-paper': a Sony DPT-RP1/CP1 over Wi-Fi (paired). 'mtp': an Android e-reader or tablet (Boox, Kindle, ...) over USB. */
export type ReaderKind = 'digital-paper' | 'mtp';
export type Reader = {
  /** 'dpt' for the paired Digital Paper, 'mtp:<hash>' for a USB device (stable while it stays plugged in) */
  id: string;
  kind: ReaderKind;
  /** what to call it: "DPT-RP1", "Tab X C" */
  name: string;
  /** manufacturer: "Sony", "ONYX" */
  maker: string;
  /** reachable right now (Wi-Fi session alive / USB device present) */
  connected: boolean;
  link: 'wifi' | 'usb';
};

// ---------- MTP readers (files over USB) ----------
export type MtpStorage = { id: number; name: string; total: number; free: number };
export type MtpStatus = {
  id: string;
  maker: string;
  /** product name as the device reports it, e.g. "TabXC" */
  model: string;
  /** friendly name when it has one, e.g. "Tab X C"; falls back to the model */
  name: string;
  storages: MtpStorage[];
  /** "High speed (480 Mbit/s)", "SuperSpeed (5 Gbit/s)", ... when the OS reports it */
  usbSpeed: string | null;
};
export type MtpEntry = {
  handle: number;
  name: string;
  kind: 'file' | 'folder';
  size: number;
  /** ISO 8601 or null when the device does not say */
  modified: string | null;
};
/** Where a dashboard is published when the target is a USB reader. */
export type PublishTarget =
  | { kind: 'dpt' }
  | { kind: 'mtp'; readerId: string; /** folder on the device storage; empty = default for the format */ folder: string; format: PublishFormat };
/** 'pdf': one document. 'png': one picture per page. 'template': pictures saved where the reader's note app looks for pen templates (Boox: the noteTemplate folder), so the page can be written on with the pen. */
export type PublishFormat = 'pdf' | 'png' | 'template';

// ---------- USB debugging (ADB) on Android readers ----------
/** 'unavailable': the reader offers no debugging connection (USB debugging is off on it). 'off': it does, but this computer is not connected. 'ready': connected and approved on the reader. */
export type AdbState = 'unavailable' | 'off' | 'ready';
export type AdbStatus = {
  state: AdbState;
  /** e.g. "13" */
  android: string | null;
  battery: { level: number; charging: boolean } | null;
  /** the physical screen in pixels, e.g. 2400 x 3200 */
  screen: { width: number; height: number } | null;
};
