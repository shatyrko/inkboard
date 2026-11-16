// Invented library for the browser mock: Latin and Cyrillic names, handwritten notes, some unread items.
import type { Entry } from '../lib/types';

export const ROOT_ID = 'root-folder';

let seq = 0;
export const newId = () => `00000000-0000-4000-8000-${(++seq).toString(16).padStart(12, '0')}`;

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

type Seed = { name: string; pages: number; mb: number; modified: number; read?: [daysAgo: number, page: number]; note?: boolean; isNew?: boolean };

const LIBRARY: Record<string, Seed[]> = {
  Document: [
    { name: 'Quick start guide.pdf', pages: 12, mb: 1.4, modified: 400 },
    { name: 'Reading list 2026.pdf', pages: 3, mb: 0.2, modified: 9, isNew: true },
  ],
  'Document/Книги': [
    { name: 'Сад камней.pdf', pages: 248, mb: 6.8, modified: 120, read: [3, 112] },
    { name: 'Дорога на север.pdf', pages: 312, mb: 9.4, modified: 200, read: [40, 312] },
    { name: 'Ёлка и ёж.pdf', pages: 36, mb: 2.1, modified: 60, isNew: true },
    { name: 'Заметки о тишине.pdf', pages: 154, mb: 4.5, modified: 18, read: [1, 23] },
    { name: 'A Short History of Clocks.pdf', pages: 402, mb: 12.6, modified: 90, read: [12, 87] },
    { name: 'Café Culture in Vienna.pdf', pages: 188, mb: 7.7, modified: 75 },
  ],
  'Document/Книги/Поэзия': [
    { name: 'Зимние строки.pdf', pages: 64, mb: 1.9, modified: 140, read: [80, 64] },
    { name: 'Ночные огни.pdf', pages: 88, mb: 2.6, modified: 30 },
  ],
  'Document/Papers': [
    { name: 'Field Notes on Lichens.pdf', pages: 22, mb: 1.8, modified: 14, read: [2, 9] },
    { name: 'Müller - Thermodynamics (draft).pdf', pages: 74, mb: 3.3, modified: 5, read: [5, 41] },
    { name: 'Ångström measurements.pdf', pages: 18, mb: 0.9, modified: 50 },
    { name: 'Annual Report 2024.pdf', pages: 96, mb: 5.2, modified: 160, read: [150, 14] },
    { name: 'Квартальный отчёт.pdf', pages: 28, mb: 1.2, modified: 20 },
  ],
  'Document/Notes': [
    { name: 'Идеи для проекта.pdf', pages: 6, mb: 0.4, modified: 2, read: [2, 6], note: true },
    { name: 'Sketch - kitchen shelves.pdf', pages: 3, mb: 0.3, modified: 11, note: true },
    { name: 'Lecture 12 scribbles.pdf', pages: 9, mb: 0.6, modified: 25, note: true },
    { name: 'Meeting notes - March.pdf', pages: 4, mb: 0.3, modified: 220, note: true },
  ],
  'Document/Dashboards': [
    { name: 'Morning overview.pdf', pages: 1, mb: 0.1, modified: 0 },
    { name: 'Week ahead.pdf', pages: 2, mb: 0.2, modified: 1 },
  ],
};

export function folderEntry(path: string, parentId: string): Entry {
  return {
    id: newId(), name: path.slice(path.lastIndexOf('/') + 1), path, kind: 'folder', docType: null, parentId,
    size: 0, mime: null, created: daysAgo(300), modified: daysAgo(30), lastRead: null, currentPage: 0, totalPage: 0, isNew: false,
  };
}

export function documentEntry(path: string, parentId: string, s: Seed): Entry {
  return {
    id: newId(), name: s.name, path, kind: 'document', docType: s.note ? 'note' : 'normal', parentId,
    size: Math.round(s.mb * 1_000_000), mime: 'application/pdf', created: daysAgo(s.modified + 1), modified: daysAgo(s.modified),
    lastRead: s.read ? daysAgo(s.read[0]) : null, currentPage: s.read ? s.read[1] : 1, totalPage: s.pages, isNew: !!s.isNew,
  };
}

/** the root folder is not listed, like a reader that only names it as the parent of its children */
export function seedLibrary(): Entry[] {
  const out: Entry[] = [];
  const ids = new Map<string, string>([['Document', ROOT_ID]]);
  for (const path of Object.keys(LIBRARY)) {
    if (path === 'Document') continue;
    const parent = path.slice(0, path.lastIndexOf('/'));
    const f = folderEntry(path, ids.get(parent) ?? ROOT_ID);
    ids.set(path, f.id);
    out.push(f);
  }
  for (const [path, docs] of Object.entries(LIBRARY)) {
    for (const s of docs) out.push(documentEntry(`${path}/${s.name}`, ids.get(path) ?? ROOT_ID, s));
  }
  return out;
}

/** ?mock=big: about two thousand more documents, to check that the table stays quick */
export function bigLibrary(): Entry[] {
  const out = seedLibrary();
  const nouns = ['Harbour', 'Orchard', 'Compass', 'Lantern', 'Meadow', 'Glacier', 'Archive', 'Atlas', 'Ledger', 'Voyage'];
  const kinds = ['Notes', 'Report', 'Survey', 'Draft', 'Essay', 'Manual', 'Study'];
  const f = folderEntry('Document/Archive', ROOT_ID);
  out.push(f);
  for (let i = 0; i < 2000; i++) {
    const name = `${nouns[i % nouns.length]} ${kinds[(i * 7) % kinds.length]} ${i + 1}.pdf`;
    out.push(documentEntry(`${f.path}/${name}`, f.id, { name, pages: 5 + ((i * 37) % 300), mb: 0.2 + ((i * 13) % 90) / 10, modified: 1 + ((i * 11) % 700), read: i % 3 ? undefined : [1 + (i % 90), 1] }));
  }
  return out;
}
