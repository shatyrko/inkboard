import { describe, expect, it } from 'vitest';
import { baseName, isInside, joinPath, normaliseFolder, parentPath, relativeToRoot, splitExt, trail, uniqueName, validateName } from './paths';

describe('remote paths', () => {
  it('splits and joins', () => {
    expect(parentPath('Document/Books/x.pdf')).toBe('Document/Books');
    expect(parentPath('Document')).toBe('');
    expect(baseName('Document/Books/x.pdf')).toBe('x.pdf');
    expect(joinPath('Document', '', 'Books')).toBe('Document/Books');
  });
  it('knows what is inside a folder', () => {
    expect(isInside('Document/Books/x.pdf', 'Document/Books')).toBe(true);
    expect(isInside('Document/Books', 'Document/Books')).toBe(true);
    expect(isInside('Document/Books2/x.pdf', 'Document/Books')).toBe(false);
  });
  it('lists the trail from the root', () => {
    expect(trail('Document/Books/Poetry')).toEqual([
      { name: 'Document', path: 'Document' },
      { name: 'Books', path: 'Document/Books' },
      { name: 'Poetry', path: 'Document/Books/Poetry' },
    ]);
  });
  it('drops the root for display', () => {
    expect(relativeToRoot('Document/Books/x.pdf')).toBe('Books/x.pdf');
    expect(relativeToRoot('Document')).toBe('');
  });
});

describe('names', () => {
  it('splits a short extension only', () => {
    expect(splitExt('report.final.pdf')).toEqual({ stem: 'report.final', ext: '.pdf' });
    expect(splitExt('Meeting.notes from March')).toEqual({ stem: 'Meeting.notes from March', ext: '' });
    expect(splitExt('.hidden')).toEqual({ stem: '.hidden', ext: '' });
  });
  it('validates against slashes, emptiness and duplicates', () => {
    expect(validateName('Fine name.pdf', ['other.pdf'])).toBe('');
    expect(validateName('   ')).not.toBe('');
    expect(validateName('a/b')).not.toBe('');
    expect(validateName('..')).not.toBe('');
    expect(validateName('OTHER.pdf', ['other.pdf'])).not.toBe('');
  });
  it('makes a unique name by counting up', () => {
    expect(uniqueName('a.pdf', ['b.pdf'])).toBe('a.pdf');
    expect(uniqueName('a.pdf', ['A.pdf'])).toBe('a (2).pdf');
    expect(uniqueName('a.pdf', ['a.pdf', 'a (2).pdf'])).toBe('a (3).pdf');
    expect(uniqueName('Notes', ['Notes'])).toBe('Notes (2)');
  });
  it('keeps typed folders below the root', () => {
    expect(normaliseFolder('Dashboards')).toBe('Document/Dashboards');
    expect(normaliseFolder('document\\Dash//boards/')).toBe('Document/Dash/boards');
    expect(normaliseFolder('Document')).toBe('Document');
    expect(normaliseFolder(' Documents/Dash ')).toBe('Document/Documents/Dash');
  });
});
