// Deleting on a USB reader is permanent, and a folder takes everything in it along, so say what goes before sending anything.
import { fmtBytes } from '../../lib/format';
import type { MtpEntry } from '../../lib/types';
import { plural } from '../shared/text';

export type Summary = { files: number; folders: number; bytes: number };

export function summarise(entries: readonly MtpEntry[]): Summary {
  return {
    files: entries.filter((e) => e.kind === 'file').length,
    folders: entries.filter((e) => e.kind === 'folder').length,
    bytes: entries.reduce((n, e) => n + (e.kind === 'file' ? e.size : 0), 0),
  };
}

/** "Delete "a.epub" (1.2 MB)?", "Delete 2 files and 1 folder (12 MB)?" - the size counts files only, a folder's content is not listed */
export function deleteTitle(entries: readonly MtpEntry[]): string {
  const s = summarise(entries);
  const size = s.bytes ? ` (${fmtBytes(s.bytes)})` : '';
  if (entries.length === 1) return `Delete "${entries[0].name}"${size}?`;
  const parts = [s.files ? plural(s.files, 'file') : '', s.folders ? plural(s.folders, 'folder') : ''].filter(Boolean);
  return `Delete ${parts.join(' and ')}${size}?`;
}

export function deleteBody(entries: readonly MtpEntry[]): string {
  const s = summarise(entries);
  const lines = ['They are removed from the reader for good. This cannot be undone.'];
  if (s.folders) lines.push(`${s.folders === 1 ? 'The folder goes' : 'The folders go'} with everything inside ${s.folders === 1 ? 'it' : 'them'}.`);
  return lines.join(' ');
}
