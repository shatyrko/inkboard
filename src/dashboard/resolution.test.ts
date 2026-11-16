import { describe, expect, it } from 'vitest';
import { newDashboard, type Dashboard } from './model';
import { MAX_SCALE, nativeSize, offeredNativeSize, renderSizeFor, resolutionOptions, usesPictures } from './resolution';

const portrait = { width: 1650, height: 2200 };
const landscape = { width: 2200, height: 1650 };
const boox = { width: 2400, height: 3200 };

const to = (format: 'pdf' | 'png' | 'template', over: Partial<Dashboard> = {}, resolution?: 'native' | 'standard'): Dashboard => ({
  ...newDashboard('Day'),
  ...over,
  publish: { target: { kind: 'mtp', readerId: 'mtp:ab12', folder: '', format }, ...(resolution ? { resolution } : {}) },
});

describe('nativeSize', () => {
  it('fills a screen of the same shape: 2400 x 3200 for a portrait page', () => {
    const n = nativeSize(portrait, boox)!;
    expect(n).toMatchObject({ width: 2400, height: 3200 });
    expect(n.scale).toBeCloseTo(2400 / 1650);
  });

  it('fits a landscape page to a screen that is held portrait, and the other way round', () => {
    expect(nativeSize(landscape, boox)).toMatchObject({ width: 3200, height: 2400 });
    expect(nativeSize(portrait, { width: 3200, height: 2400 })).toMatchObject({ width: 2400, height: 3200 });
    expect(nativeSize(landscape, { width: 3200, height: 2400 })).toMatchObject({ width: 3200, height: 2400 });
  });

  it('accepts a shape within 1 % and refuses one that would have to be stretched', () => {
    expect(nativeSize(portrait, { width: 2400, height: 3190 })).not.toBeNull();
    expect(nativeSize(portrait, { width: 1404, height: 1872 })).toMatchObject({ width: 1404, height: 1872 });
    expect(nativeSize(portrait, { width: 1072, height: 1448 })).toBeNull();
    expect(nativeSize(portrait, { width: 1600, height: 2560 })).toBeNull();
  });

  it('is null without a usable screen size', () => {
    expect(nativeSize(portrait, null)).toBeNull();
    expect(nativeSize(portrait, undefined)).toBeNull();
    expect(nativeSize(portrait, { width: 0, height: 3200 })).toBeNull();
  });

  it('never scales beyond twice the standard size', () => {
    expect(MAX_SCALE).toBe(2);
    expect(nativeSize(portrait, { width: 4000, height: 5333 })).toEqual({ width: 3300, height: 4400, scale: 2 });
  });
});

describe('what is offered', () => {
  it('is for pictures only: PNG and pen templates, not PDF, not the Digital Paper', () => {
    expect(usesPictures({ kind: 'dpt' })).toBe(false);
    expect(usesPictures({ kind: 'mtp', readerId: 'x', folder: '', format: 'pdf' })).toBe(false);
    expect(usesPictures({ kind: 'mtp', readerId: 'x', folder: '', format: 'png' })).toBe(true);
    expect(usesPictures({ kind: 'mtp', readerId: 'x', folder: '', format: 'template' })).toBe(true);
    expect(offeredNativeSize(to('pdf'), boox)).toBeNull();
    expect(offeredNativeSize(newDashboard('A'), boox)).toBeNull();
    expect(offeredNativeSize(to('png'), boox)).toMatchObject({ width: 2400 });
    expect(offeredNativeSize(to('template'), boox)).toMatchObject({ width: 2400 });
  });

  it('is not offered when the screen is the standard size, or does not match, or is unknown', () => {
    expect(offeredNativeSize(to('png'), portrait)).toBeNull();
    expect(offeredNativeSize(to('png'), { width: 1072, height: 1448 })).toBeNull();
    expect(offeredNativeSize(to('png'), null)).toBeNull();
  });

  it('words the two choices with the real sizes', () => {
    expect(resolutionOptions(to('png'), boox)).toEqual([
      { value: 'native', label: 'Match the reader (2400 x 3200)' },
      { value: 'standard', label: 'Standard (1650 x 2200)' },
    ]);
    expect(resolutionOptions(to('png', { orientation: 'landscape' }), boox)).toEqual([
      { value: 'native', label: 'Match the reader (3200 x 2400)' },
      { value: 'standard', label: 'Standard (2200 x 1650)' },
    ]);
    expect(resolutionOptions(to('pdf'), boox)).toBeNull();
  });
});

describe('renderSizeFor', () => {
  it('defaults to the reader\'s own size for pictures', () => {
    expect(renderSizeFor(to('png'), boox)).toMatchObject({ width: 2400, height: 3200 });
    expect(renderSizeFor(to('template'), boox, ).scale).toBeCloseTo(1.4545, 3);
    expect(renderSizeFor(to('png', { orientation: 'landscape' }), boox)).toMatchObject({ width: 3200, height: 2400 });
  });

  it('keeps the standard size when asked to, for PDFs, for the Digital Paper and when nothing matches', () => {
    expect(renderSizeFor(to('png', {}, 'standard'), boox)).toEqual({ ...portrait, scale: 1 });
    expect(renderSizeFor(to('png', {}, 'native'), boox)).toMatchObject({ width: 2400 });
    expect(renderSizeFor(to('pdf'), boox)).toEqual({ ...portrait, scale: 1 });
    expect(renderSizeFor(newDashboard('A'), boox)).toEqual({ ...portrait, scale: 1 });
    expect(renderSizeFor(to('png'), { width: 1072, height: 1448 })).toEqual({ ...portrait, scale: 1 });
    expect(renderSizeFor(to('png'), null)).toEqual({ ...portrait, scale: 1 });
  });
});
