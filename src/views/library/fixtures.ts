// Small invented library for the unit tests.
import type { Entry } from '../../lib/types';

let n = 0;

export function folder(path: string, parentId: string, over: Partial<Entry> = {}): Entry {
  return {
    id: `f${++n}`, name: path.slice(path.lastIndexOf('/') + 1), path, kind: 'folder', docType: null, parentId,
    size: 0, mime: null, created: '2025-01-01T00:00:00Z', modified: '2025-01-01T00:00:00Z', lastRead: null, currentPage: 0, totalPage: 0, isNew: false, ...over,
  };
}

export function doc(path: string, parentId: string, over: Partial<Entry> = {}): Entry {
  return {
    id: `d${++n}`, name: path.slice(path.lastIndexOf('/') + 1), path, kind: 'document', docType: 'normal', parentId,
    size: 1_000_000, mime: 'application/pdf', created: '2025-01-01T00:00:00Z', modified: '2025-02-01T00:00:00Z', lastRead: null, currentPage: 1, totalPage: 100, isNew: false, ...over,
  };
}

/** Document/{Books/{Poetry}, Papers}, plus loose documents in the root; the root itself is not listed */
export function library(): Entry[] {
  const books = folder('Document/Books', 'root');
  const poetry = folder('Document/Books/Poetry', books.id);
  const papers = folder('Document/Papers', 'root');
  return [
    books, poetry, papers,
    doc('Document/Cafe menu.pdf', 'root', { size: 500_000, totalPage: 2 }),
    doc('Document/Books/Ёлка и ёж.pdf', books.id, { size: 3_000_000, totalPage: 40, lastRead: '2025-06-01T00:00:00Z' }),
    doc('Document/Books/Café Culture in Vienna.pdf', books.id, { size: 9_000_000, totalPage: 310, lastRead: '2025-08-01T00:00:00Z' }),
    doc('Document/Books/Poetry/Тихие стихи.pdf', poetry.id, { totalPage: 64 }),
    doc('Document/Papers/Draft 10.pdf', papers.id, { totalPage: 12 }),
    doc('Document/Papers/Draft 2.pdf', papers.id, { totalPage: 8 }),
    doc('Document/Papers/Lecture scribbles.pdf', papers.id, { docType: 'note', totalPage: 5, size: 200_000 }),
  ];
}
