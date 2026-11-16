// What each kind of reader can do, so the views can offer exactly that and nothing else.
import type { PublishFormat, Reader, ReaderKind } from './types';

export type Capabilities = {
  /** 'documents': the reader's own library of PDFs (folders and documents). 'filesystem': a plain file manager over USB. */
  files: 'documents' | 'filesystem';
  /** settings on the reader itself (date and time, time zone, standby, owner) */
  deviceSettings: boolean;
  wifiManagement: boolean;
  /** a live picture of the reader's screen */
  screenMirror: boolean;
  /** the app can open a document on the reader's screen */
  openOnReader: boolean;
  /** dashboard file formats the reader can show */
  dashboardFormats: PublishFormat[];
};

const TABLE: Record<ReaderKind, Capabilities> = {
  'digital-paper': { files: 'documents', deviceSettings: true, wifiManagement: true, screenMirror: true, openOnReader: true, dashboardFormats: ['pdf'] },
  mtp: { files: 'filesystem', deviceSettings: false, wifiManagement: false, screenMirror: false, openOnReader: false, dashboardFormats: ['pdf', 'png', 'template'] },
};

export const capabilities = (kind: ReaderKind): Capabilities => TABLE[kind];

/** "Sony DPT-RP1", "ONYX Tab X C" */
export function readerTitle(r: Pick<Reader, 'maker' | 'name'>): string {
  return r.name.toLowerCase().startsWith(r.maker.toLowerCase()) ? r.name : `${r.maker} ${r.name}`.trim();
}

/** A USB reader gains screen mirroring and "open on the reader" once USB debugging (ADB) is connected. */
export function capabilitiesWith(kind: ReaderKind, adbReady: boolean): Capabilities {
  const base = TABLE[kind];
  return kind === 'mtp' && adbReady ? { ...base, screenMirror: true, openOnReader: true } : base;
}
