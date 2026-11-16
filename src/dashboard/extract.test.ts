import { describe, expect, it } from 'vitest';
import { extractValue, getPath, parsePath } from './extract';

describe('parsePath', () => {
  it('reads keys, indexes and quoted keys', () => {
    expect(parsePath('a.b[0].c')).toEqual(['a', 'b', 0, 'c']);
    expect(parsePath('$.items[-1]')).toEqual(['items', -1]);
    expect(parsePath("data['two words'].x")).toEqual(['data', 'two words', 'x']);
    expect(parsePath('[2][1]')).toEqual([2, 1]);
  });

  it('rejects malformed paths', () => {
    expect(parsePath('a[')).toBeNull();
    expect(parsePath('a[b]')).toBeNull();
  });
});

describe('getPath', () => {
  const doc = { main: { temp: 21.5, tags: ['x', 'y'] }, list: [{ n: 1 }, { n: 2 }], zero: 0, no: null };

  it('walks objects and arrays', () => {
    expect(getPath(doc, 'main.temp')).toBe(21.5);
    expect(getPath(doc, 'main.tags[1]')).toBe('y');
    expect(getPath(doc, 'list[-1].n')).toBe(2);
  });

  it('returns falsy values that exist', () => {
    expect(getPath(doc, 'zero')).toBe(0);
    expect(getPath(doc, 'no')).toBeNull();
  });

  it('says what is missing', () => {
    expect(() => getPath(doc, 'main.nope')).toThrow('"main.nope" not found');
    expect(() => getPath(doc, 'main[0]')).toThrow('not found');
    expect(() => getPath(doc, 'a[')).toThrow('not a valid path');
  });
});

describe('extractValue', () => {
  const json = JSON.stringify({ city: { name: 'Springfield', temp: 18.2 }, note: 'Total: 42 items' });

  it('returns the text as is without a path or pattern', () => {
    expect(extractValue('  hello \n', { path: '', regex: '' })).toBe('hello');
  });

  it('picks a JSON path and stringifies it', () => {
    expect(extractValue(json, { path: 'city.temp', regex: '' })).toBe('18.2');
    expect(extractValue(json, { path: 'city', regex: '' })).toBe('{"name":"Springfield","temp":18.2}');
  });

  it('applies a pattern after the path, preferring the first group', () => {
    expect(extractValue(json, { path: 'note', regex: 'Total: (\\d+)' })).toBe('42');
    expect(extractValue('v1.2.3', { path: '', regex: '\\d+\\.\\d+' })).toBe('1.2');
  });

  it('explains failures in plain words', () => {
    expect(() => extractValue('not json', { path: 'a', regex: '' })).toThrow('not JSON');
    expect(() => extractValue('abc', { path: '', regex: '(' })).toThrow('not a valid regular expression');
    expect(() => extractValue('abc', { path: '', regex: '\\d' })).toThrow('matched nothing');
  });
});
