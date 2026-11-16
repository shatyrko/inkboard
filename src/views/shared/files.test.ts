import { describe, expect, it } from 'vitest';
import { fileName, isPdf, listNames, partitionPdfs } from './files';

describe('local files', () => {
  it('takes the name from either path style', () => {
    expect(fileName('/home/demo/a.pdf')).toBe('a.pdf');
    expect(fileName('C:\\docs\\b.pdf')).toBe('b.pdf');
    expect(fileName('plain.pdf')).toBe('plain.pdf');
  });
  it('recognises PDFs by extension, ignoring case', () => {
    expect(isPdf('/x/A.PDF')).toBe(true);
    expect(isPdf('/x/book.epub')).toBe(false);
    expect(isPdf('/x/pdf')).toBe(false);
  });
  it('splits dropped paths into PDFs and the rest', () => {
    expect(partitionPdfs(['/a.pdf', '/b.epub', '/c.PDF', '/folder'])).toEqual({ pdfs: ['/a.pdf', '/c.PDF'], skipped: ['/b.epub', '/folder'] });
  });
  it('shortens long name lists', () => {
    expect(listNames(['/a.epub', '/b.fb2'])).toBe('a.epub, b.fb2');
    expect(listNames(['/1', '/2', '/3', '/4', '/5', '/6'], 3)).toBe('1, 2, 3 and 3 more');
  });
});
