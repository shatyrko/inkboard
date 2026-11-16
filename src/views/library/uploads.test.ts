import { describe, expect, it } from 'vitest';
import { describeUpload } from './uploads';

const ok = (name: string, note?: string) => ({ name, ok: true, error: null, note: note ?? null });

describe('describeUpload', () => {
  it('counts what went up', () => {
    expect(describeUpload([ok('a.pdf')])).toEqual({ text: 'Uploaded 1 document', failed: false });
    expect(describeUpload([ok('a.pdf'), ok('b.pdf')]).text).toBe('Uploaded 2 documents');
  });

  it('names the first failure', () => {
    const r = describeUpload([ok('a.pdf'), { name: 'b.pdf', ok: false, error: 'The reader is full.' }]);
    expect(r).toEqual({ text: '1 of 2 uploaded. "b.pdf": The reader is full.', failed: true });
  });

  it('says when a file went up without its tap squares, and how many others did too', () => {
    const one = describeUpload([ok('a.pdf'), ok('b.pdf', 'Uploaded without tap squares: The PDF is encrypted.')]);
    expect(one).toEqual({ text: 'Uploaded 2 documents. "b.pdf": Uploaded without tap squares: The PDF is encrypted.', failed: false });
    const two = describeUpload([ok('a.pdf', 'Uploaded without tap squares: x.'), ok('b.pdf', 'Uploaded without tap squares: y.')]);
    expect(two.text).toContain('1 other went up the same way.');
  });
});
