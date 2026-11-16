// Small invented folder of a USB reader for the unit tests.
import type { MtpEntry } from '../../lib/types';

let handle = 100;

export function file(name: string, size = 1_000_000, modified: string | null = '2026-01-01T00:00:00Z'): MtpEntry {
  return { handle: ++handle, name, kind: 'file', size, modified };
}

export function folder(name: string, modified: string | null = '2026-01-01T00:00:00Z'): MtpEntry {
  return { handle: ++handle, name, kind: 'folder', size: 0, modified };
}

export function sample(): MtpEntry[] {
  return [
    file('Café Culture in Vienna.mobi', 2_400_000, '2026-02-01T00:00:00Z'),
    folder('Poetry'),
    file('Ёлка и ёж.fb2', 300_000, '2026-04-01T00:00:00Z'),
    file('Draft 10.pdf', 5_000_000, null),
    file('Draft 2.pdf', 1_000_000, '2026-03-01T00:00:00Z'),
    folder('Fiction', '2026-05-01T00:00:00Z'),
  ];
}
