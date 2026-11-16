// Typed wrappers over the Tauri commands. In a plain browser (pnpm dev) every call is answered by src/mock/ instead,
// so the UI can be developed and screenshotted without the desktop shell or a reader.
import { inTauri } from './window';
import type {
  AdbStatus, AppSettings, ConfigKey, ConnectionState, DashboardSummary, DeviceConfig, DeviceStatus, DiscoveredDevice, Entry, MtpEntry, MtpStatus, ProbeResult,
  PublishMeta, PublishResult, Reader, SystemStats, TemplateEntry, TransferProgress, UploadResult, WifiConnectRequest, WifiNetwork, WifiScanResult,
} from './types';

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (inTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<T>(cmd, args);
  }
  const { handle } = await import('../mock');
  return (await handle(cmd, args ?? {})) as T;
}

export const api = {
  // connection
  connectionState: () => call<ConnectionState>('connection_state'),
  discoverDevices: () => call<DiscoveredDevice[]>('discover_devices'),
  probeDevice: (addr: string) => call<ProbeResult>('probe_device', { addr }),
  /** asks the reader to show a PIN on its screen */
  pairStart: (addr: string) => call<void>('pair_start', { addr }),
  /** completes pairing with the PIN shown on the reader and saves the keys */
  pairFinish: (pin: string) => call<ConnectionState>('pair_finish', { pin }),
  importLegacyCredentials: (addr: string) => call<ConnectionState>('import_legacy_credentials', { addr }),
  connect: () => call<ConnectionState>('connect'),
  forgetDevice: () => call<ConnectionState>('forget_device'),

  // all readers: the paired Digital Paper (if any) and every MTP device on USB right now
  readersList: () => call<Reader[]>('readers_list'),

  // USB readers over MTP (Boox and other Android e-readers). `id` is Reader.id; `storage` is MtpStorage.id; `parent` null = the storage root.
  mtpStatus: (id: string) => call<MtpStatus>('mtp_status', { id }),
  mtpList: (id: string, storage: number, parent: number | null) => call<MtpEntry[]>('mtp_list', { id, storage, parent }),
  /** uploads local files into a folder; progress arrives as `transfer-progress` events */
  mtpUpload: (id: string, storage: number, parent: number | null, paths: string[]) => call<UploadResult[]>('mtp_upload', { id, storage, parent, paths }),
  mtpDownload: (id: string, storage: number, handle: number, dest: string) => call<void>('mtp_download', { id, storage, handle, dest }),
  /** deletes a file or a folder with everything in it */
  mtpDelete: (id: string, storage: number, handle: number) => call<void>('mtp_delete', { id, storage, handle }),
  /** returns the new folder's handle */
  mtpNewFolder: (id: string, storage: number, parent: number | null, name: string) => call<number>('mtp_new_folder', { id, storage, parent, name }),
  mtpRename: (id: string, storage: number, handle: number, name: string) => call<void>('mtp_rename', { id, storage, handle, name }),
  mtpMove: (id: string, storage: number, handle: number, parent: number | null) => call<void>('mtp_move', { id, storage, handle, parent }),

  // USB debugging (ADB) on Android readers: opt-in, the reader asks the user to approve this computer the first time.
  /** never prompts: 'ready' only when a connection is already open */
  adbStatus: (id: string) => call<AdbStatus>('adb_status', { id }),
  /** connects; the reader shows "Allow USB debugging?" and this waits up to 60 s for the tap */
  adbConnect: (id: string) => call<AdbStatus>('adb_connect', { id }),
  adbDisconnect: (id: string) => call<void>('adb_disconnect', { id }),
  /** PNG data URL of the reader's screen right now (needs a ready connection) */
  adbScreenshot: (id: string) => call<string>('adb_screenshot', { id }),
  /** shows a file on the reader's screen; `path` is relative to the main storage, e.g. "Documents/Inkboard/Day.pdf" */
  adbOpen: (id: string, path: string) => call<void>('adb_open', { id, path }),

  // status and settings of the Digital Paper
  deviceStatus: () => call<DeviceStatus>('device_status'),
  /** PNG data URL of what the reader is showing right now */
  screenshot: () => call<string>('device_screenshot'),
  deviceConfig: () => call<DeviceConfig>('device_config'),
  setConfig: (key: ConfigKey, value: string) => call<void>('device_set_config', { key, value }),
  syncClock: () => call<void>('device_sync_clock'),
  wifiList: () => call<WifiNetwork[]>('wifi_list'),
  wifiScan: () => call<WifiScanResult[]>('wifi_scan'),
  wifiConnect: (req: WifiConnectRequest) => call<void>('wifi_connect', { req }),
  wifiForget: (ssid: string, security: string) => call<void>('wifi_forget', { ssid, security }),
  wifiSetEnabled: (enabled: boolean) => call<void>('wifi_set_enabled', { enabled }),

  // library
  libraryList: () => call<Entry[]>('library_list'),
  /** `folder` is a remote path such as "Document/Books"; it is created when missing */
  libraryUpload: (paths: string[], folder: string) => call<UploadResult[]>('library_upload', { paths, folder }),
  /** a copy of a document next to it, with tap squares added (the original is left alone) */
  libraryAddTapSquares: (entryId: string) => call<UploadResult>('library_add_tap_squares', { entryId }),
  libraryDownload: (entryId: string, dest: string) => call<void>('library_download', { entryId, dest }),
  libraryDelete: (entryId: string, kind: 'document' | 'folder') => call<void>('library_delete', { entryId, kind }),
  libraryNewFolder: (path: string) => call<void>('library_new_folder', { path }),
  /** moves and/or renames a document */
  libraryMove: (entryId: string, folderId: string, newName?: string | null) => call<void>('library_move', { entryId, folderId, newName: newName ?? null }),
  libraryCopy: (entryId: string, folderId: string, newName?: string | null) => call<void>('library_copy', { entryId, folderId, newName: newName ?? null }),
  /** shows the document on the reader's screen */
  libraryOpen: (entryId: string, page = 1) => call<void>('library_open', { entryId, page }),
  templatesList: () => call<TemplateEntry[]>('templates_list'),
  templatesUpload: (path: string) => call<void>('templates_upload', { path }),
  templatesDelete: (id: string) => call<void>('templates_delete', { id }),

  // dashboards (stored as JSON files in the app's config folder; the document shape is owned by src/dashboard/)
  dashboardsList: () => call<DashboardSummary[]>('dashboards_list'),
  dashboardsLoad: (id: string) => call<any>('dashboards_load', { id }),
  /** `doc` must carry string `id` and `name`; anything else is stored as given */
  dashboardsSave: (doc: { id: string; name: string; [k: string]: unknown }) => call<void>('dashboards_save', { doc }),
  dashboardsDelete: (id: string) => call<void>('dashboards_delete', { id }),
  systemStats: () => call<SystemStats>('system_stats'),
  /** GET a URL from the Rust side (no CORS); text body capped at 1 MB */
  fetchText: (url: string) => call<string>('fetch_text', { url }),
  /** reads a local image file (png/jpg/gif/webp/svg, max 8 MB) as a data URL, for the Image widget */
  readImage: (path: string) => call<string>('read_image', { path }),
  /** runs a shell command, only when AppSettings.allowCommands is on; returns stdout (capped), 10 s timeout */
  runCommand: (command: string) => call<string>('run_command', { command }),
  /** builds a PDF from the rendered pages, uploads it and optionally opens it on the reader */
  async publishDashboard(meta: PublishMeta, pixels: Uint8Array): Promise<PublishResult> {
    if (inTauri) {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke<PublishResult>('dashboard_publish', pixels, { headers: { 'x-meta': encodeURIComponent(JSON.stringify(meta)) } });
    }
    const { handle } = await import('../mock');
    return (await handle('dashboard_publish', { meta, pixels })) as PublishResult;
  },
  /** saves the same PDF to a local file instead of uploading it */
  async exportDashboardPdf(meta: PublishMeta, pixels: Uint8Array, dest: string): Promise<void> {
    if (inTauri) {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke<void>('dashboard_export_pdf', pixels, { headers: { 'x-meta': encodeURIComponent(JSON.stringify(meta)), 'x-dest': encodeURIComponent(dest) } });
    }
  },

  // app settings
  settingsGet: () => call<AppSettings>('settings_get'),
  settingsSet: (patch: Partial<AppSettings>) => call<AppSettings>('settings_set', { patch }),
};

/** subscribe to upload/download progress; returns an unsubscribe function */
export async function onTransfer(cb: (p: TransferProgress) => void): Promise<() => void> {
  if (!inTauri) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  return listen<TransferProgress>('transfer-progress', (e) => cb(e.payload));
}

/** native file picker (dialog plugin); in a browser returns null */
export async function pickFiles(opts: { title?: string; multiple?: boolean; extensions?: string[] } = {}): Promise<string[] | null> {
  if (!inTauri) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const r = await open({
    title: opts.title,
    multiple: opts.multiple ?? true,
    filters: opts.extensions ? [{ name: 'Files', extensions: opts.extensions }] : undefined,
  });
  if (!r) return null;
  return Array.isArray(r) ? r : [r];
}

export async function pickSavePath(defaultName: string, extensions?: string[]): Promise<string | null> {
  if (!inTauri) return null;
  const { save } = await import('@tauri-apps/plugin-dialog');
  return (await save({ defaultPath: defaultName, filters: extensions ? [{ name: 'Files', extensions }] : undefined })) ?? null;
}

export async function pickFolder(title?: string): Promise<string | null> {
  if (!inTauri) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const r = await open({ title, directory: true, multiple: false });
  return typeof r === 'string' ? r : null;
}

/** files dragged from the desktop onto the window (absolute paths); returns an unsubscribe function */
export async function onFilesDropped(handlers: { enter?: () => void; leave?: () => void; drop: (paths: string[]) => void }): Promise<() => void> {
  if (!inTauri) return () => {};
  const { getCurrentWebview } = await import('@tauri-apps/api/webview');
  return getCurrentWebview().onDragDropEvent((e) => {
    const p = e.payload;
    if (p.type === 'enter') handlers.enter?.();
    else if (p.type === 'leave') handlers.leave?.();
    else if (p.type === 'drop') { handlers.leave?.(); handlers.drop(p.paths); }
  });
}

export async function openUrl(url: string): Promise<void> {
  if (!inTauri) { window.open(url, '_blank'); return; }
  const { openUrl: open } = await import('@tauri-apps/plugin-opener');
  await open(url);
}
