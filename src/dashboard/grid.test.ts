import { describe, expect, it } from 'vitest';
import { clampRect, fitScale, gridOf, moveRect, pageSize, resizeRect, snapToCell, toPixels } from './grid';

const portrait = gridOf('portrait');
const min = { w: 2, h: 2 };

describe('page geometry', () => {
  it('is 33 x 44 cells of 50 px in portrait and swaps in landscape', () => {
    expect(portrait).toEqual({ cols: 33, rows: 44 });
    expect(pageSize('portrait')).toEqual({ width: 1650, height: 2200 });
    expect(pageSize('landscape')).toEqual({ width: 2200, height: 1650 });
  });

  it('converts cells to pixels and pixels to the nearest cell', () => {
    expect(toPixels({ x: 1, y: 2, w: 3, h: 4 })).toEqual({ x: 50, y: 100, w: 150, h: 200 });
    expect(snapToCell(74)).toBe(1);
    expect(snapToCell(76)).toBe(2);
    expect(snapToCell(-30)).toBe(-1);
  });
});

describe('clampRect and moveRect', () => {
  it('keeps a rectangle on the page and above the minimum size', () => {
    expect(clampRect({ x: 40, y: -3, w: 10, h: 1 }, portrait, min)).toEqual({ x: 23, y: 0, w: 10, h: 2 });
    expect(clampRect({ x: 0, y: 0, w: 99, h: 99 }, portrait)).toEqual({ x: 0, y: 0, w: 33, h: 44 });
  });

  it('rounds fractional input to whole cells', () => {
    expect(clampRect({ x: 1.4, y: 2.6, w: 3.5, h: 3.4 }, portrait)).toEqual({ x: 1, y: 3, w: 4, h: 3 });
  });

  it('stops a move at the page edges', () => {
    const r = { x: 30, y: 2, w: 3, h: 3 };
    expect(moveRect(r, 5, -9, portrait)).toEqual({ x: 30, y: 0, w: 3, h: 3 });
    expect(moveRect(r, -40, 100, portrait)).toEqual({ x: 0, y: 41, w: 3, h: 3 });
  });
});

describe('resizeRect', () => {
  const r = { x: 10, y: 10, w: 6, h: 6 };

  it('grows from the south-east corner', () => {
    expect(resizeRect(r, 'se', 2, 3, min, portrait)).toEqual({ x: 10, y: 10, w: 8, h: 9 });
  });

  it('moves the north-west corner and keeps the opposite one still', () => {
    expect(resizeRect(r, 'nw', -3, -2, min, portrait)).toEqual({ x: 7, y: 8, w: 9, h: 8 });
  });

  it('never goes below the minimum size or crosses the opposite edge', () => {
    expect(resizeRect(r, 'w', 50, 0, min, portrait)).toEqual({ x: 14, y: 10, w: 2, h: 6 });
    expect(resizeRect(r, 's', 0, -50, min, portrait)).toEqual({ x: 10, y: 10, w: 6, h: 2 });
  });

  it('never leaves the page', () => {
    expect(resizeRect(r, 'e', 99, 0, min, portrait)).toEqual({ x: 10, y: 10, w: 23, h: 6 });
    expect(resizeRect(r, 'n', 0, -99, min, portrait)).toEqual({ x: 10, y: 0, w: 6, h: 16 });
  });

  it('a side handle changes one axis only', () => {
    expect(resizeRect(r, 'e', 3, 7, min, portrait)).toEqual({ x: 10, y: 10, w: 9, h: 6 });
  });
});

describe('fitScale', () => {
  it('fits the page into a box with padding and never upscales past the cap', () => {
    expect(fitScale({ width: 1650, height: 2200 }, { width: 600, height: 700 }, 10)).toBeCloseTo(680 / 2200);
    expect(fitScale({ width: 100, height: 100 }, { width: 5000, height: 5000 })).toBe(1);
  });
});
