import { describe, expect, it } from 'vitest';
import type { AdbStatus } from '../../lib/types';
import { batteryLine, cardState, screenAspect, screenLabel } from './adbCard';

const status = (state: AdbStatus['state']): AdbStatus => ({ state, android: null, battery: null, screen: null });

describe('cardState', () => {
  it('maps the three states the reader reports', () => {
    expect(cardState(status('unavailable'), false, '')).toBe('unavailable');
    expect(cardState(status('off'), false, '')).toBe('off');
    expect(cardState(status('ready'), false, '')).toBe('ready');
  });
  it('checks first while nothing is known', () => {
    expect(cardState(undefined, false, '')).toBe('checking');
  });
  it('waits for the tap while a connection attempt runs, whatever was shown before', () => {
    expect(cardState(status('off'), true, 'old error')).toBe('waiting');
    expect(cardState(undefined, true, '')).toBe('waiting');
  });
  it('shows the failure after an attempt that did not work', () => {
    expect(cardState(status('off'), false, 'You tapped Deny.')).toBe('failed');
  });
  it('lets the reader decide when it says the connection is gone or ready', () => {
    expect(cardState(status('unavailable'), false, 'old error')).toBe('unavailable');
    expect(cardState(status('ready'), false, 'old error')).toBe('ready');
  });
});

describe('wording', () => {
  it('writes the battery', () => {
    expect(batteryLine({ level: 87, charging: false })).toBe('87%');
    expect(batteryLine({ level: 41.6, charging: true })).toBe('42%, charging');
  });
  it('writes the screen size', () => {
    expect(screenLabel({ width: 2400, height: 3200 })).toBe('2400 x 3200 px');
  });
  it('gives the screen shape, 3:4 when unknown', () => {
    expect(screenAspect({ width: 1650, height: 2200 })).toBe(0.75);
    expect(screenAspect(null)).toBe(0.75);
    expect(screenAspect({ width: 0, height: 0 })).toBe(0.75);
  });
});
