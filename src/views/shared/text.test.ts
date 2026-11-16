import { describe, expect, it } from 'vitest';
import { fold, matchesAll, plural, words } from './text';

describe('fold', () => {
  it('lower-cases and strips accents', () => {
    expect(fold('Café Müller')).toBe('cafe muller');
    expect(fold('Ångström')).toBe('angstrom');
  });
  it('treats ё as е but keeps й distinct from и', () => {
    expect(fold('Ёлка')).toBe('елка');
    expect(fold('Война')).toBe('война');
    expect(fold('Война')).not.toBe(fold('Воина'));
  });
  it('folds letters NFD does not decompose', () => {
    expect(fold('Łódź Straße Øre')).toBe('lodz strasse ore');
  });
});

describe('matchesAll', () => {
  it('needs every word, in any order', () => {
    const n = words('vienna CAFÉ');
    expect(matchesAll('Books/Café Culture in Vienna.pdf', n)).toBe(true);
    expect(matchesAll('Books/Café Culture.pdf', n)).toBe(false);
  });
  it('matches everything for an empty query', () => {
    expect(matchesAll('anything', words('   '))).toBe(true);
  });
  it('finds Cyrillic names without ё typed', () => {
    expect(matchesAll('Ёлка и ёж.pdf', words('елка еж'))).toBe(true);
  });
});

describe('plural', () => {
  it('counts with the right form', () => {
    expect(plural(1, 'document')).toBe('1 document');
    expect(plural(3, 'document')).toBe('3 documents');
    expect(plural(0, 'item')).toBe('0 items');
    expect(plural(2, 'folder', 'folders!')).toBe('2 folders!');
  });
});
