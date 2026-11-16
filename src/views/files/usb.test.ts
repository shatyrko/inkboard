import { describe, expect, it } from 'vitest';
import { speedAdvice, usage } from './usb';

describe('speedAdvice', () => {
  it('is happy with SuperSpeed and above', () => {
    expect(speedAdvice('SuperSpeed (5 Gbit/s)').level).toBe('ok');
    expect(speedAdvice('SuperSpeed+ (10 Gbit/s)').level).toBe('ok');
  });
  it('suggests a faster cable below that', () => {
    const a = speedAdvice('High speed (480 Mbit/s)');
    expect(a.level).toBe('slow');
    expect(a.text).toContain('faster cable or port');
    expect(speedAdvice('Full speed (12 Mbit/s)').level).toBe('slow');
  });
  it('reads the names when there is no figure', () => {
    expect(speedAdvice('SuperSpeed').level).toBe('ok');
    expect(speedAdvice('High speed').level).toBe('slow');
  });
  it('says so when the speed is unknown', () => {
    expect(speedAdvice(null).level).toBe('unknown');
    expect(speedAdvice('something else').level).toBe('unknown');
  });
});

describe('usage', () => {
  it('works out used bytes and the percentage', () => {
    expect(usage(100, 25)).toEqual({ used: 75, pct: 75 });
  });
  it('copes with an empty or odd storage', () => {
    expect(usage(0, 0)).toEqual({ used: 0, pct: 0 });
    expect(usage(100, 150)).toEqual({ used: 0, pct: 0 });
  });
});
