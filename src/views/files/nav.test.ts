import { describe, expect, it } from 'vitest';
import { currentHandle, enterFolder, folderPath, goTo, goUp, startStack } from './nav';

describe('folder navigation', () => {
  const root = startStack('Internal storage');

  it('starts at the storage root', () => {
    expect(currentHandle(root)).toBeNull();
    expect(folderPath(root)).toBe('');
  });
  it('goes into folders and builds the path', () => {
    const s = enterFolder(enterFolder(root, { handle: 5, name: 'Books' }), { handle: 9, name: 'Fiction' });
    expect(currentHandle(s)).toBe(9);
    expect(folderPath(s)).toBe('Books/Fiction');
  });
  it('goes up one level and stops at the root', () => {
    const s = enterFolder(root, { handle: 5, name: 'Books' });
    expect(goUp(s)).toEqual(root);
    expect(goUp(root)).toEqual(root);
  });
  it('jumps back to a crumb', () => {
    const s = enterFolder(enterFolder(root, { handle: 5, name: 'Books' }), { handle: 9, name: 'Fiction' });
    expect(goTo(s, 1).map((c) => c.name)).toEqual(['Internal storage', 'Books']);
    expect(goTo(s, 0)).toEqual(root);
    expect(goTo(s, -3)).toEqual(root);
  });
  it('does not change the stack it is given', () => {
    const s = enterFolder(root, { handle: 5, name: 'Books' });
    goUp(s);
    goTo(s, 0);
    expect(s).toHaveLength(2);
  });
});
