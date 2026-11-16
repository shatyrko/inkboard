import { describe, expect, it } from 'vitest';
import { app, activeReader } from './store';
import { cycleReader, dptStateDiffers, readerStatus } from './readerList';
import { readerTitle } from './readers';
import type { ConnectionState, Reader } from './types';

const dpt: Reader = { id: 'dpt', kind: 'digital-paper', name: 'DPT-RP1', maker: 'Sony', connected: true, link: 'wifi' };
const usb: Reader = { id: 'mtp:abc', kind: 'mtp', name: 'Tab X C', maker: 'ONYX', connected: true, link: 'usb' };

describe('cycleReader', () => {
  it('goes to the next reader and wraps round', () => {
    expect(cycleReader([dpt, usb], 'dpt')).toBe('mtp:abc');
    expect(cycleReader([dpt, usb], 'mtp:abc')).toBe('dpt');
  });
  it('goes backwards too', () => {
    expect(cycleReader([dpt, usb], 'dpt', -1)).toBe('mtp:abc');
    const third: Reader = { ...usb, id: 'mtp:def' };
    expect(cycleReader([dpt, usb, third], 'mtp:abc', -1)).toBe('dpt');
  });
  it('has nowhere to go with fewer than two readers', () => {
    expect(cycleReader([dpt], 'dpt')).toBeNull();
    expect(cycleReader([], null)).toBeNull();
  });
  it('treats an unknown current reader as the first one', () => {
    expect(cycleReader([dpt, usb], 'gone')).toBe('mtp:abc');
  });
});

describe('activeReader', () => {
  it('is the remembered reader while it is listed', () => {
    app.readers = [dpt, usb];
    app.reader = 'mtp:abc';
    expect(activeReader()?.id).toBe('mtp:abc');
  });
  it('falls back to the first reader when the remembered one is gone', () => {
    app.readers = [usb];
    app.reader = 'dpt';
    expect(activeReader()?.id).toBe('mtp:abc');
  });
  it('is null when there is no reader at all', () => {
    app.readers = [];
    expect(activeReader()).toBeNull();
  });
});

describe('readerStatus', () => {
  it('says what is going on', () => {
    expect(readerStatus(dpt, false)).toBe('Connected');
    expect(readerStatus({ ...dpt, connected: false }, false)).toBe('Not connected');
    expect(readerStatus({ ...dpt, connected: false }, true)).toBe('Connecting...');
    expect(readerStatus({ ...usb, connected: false }, true)).toBe('Not connected');
  });
});

describe('dptStateDiffers', () => {
  const conn = (connected: boolean): ConnectionState => ({ configured: true, addr: '192.0.2.41', serial: 'DEMO-1', connected, legacyCredentials: false });
  it('notices a Digital Paper that the two sources see differently', () => {
    expect(dptStateDiffers([dpt], conn(false))).toBe(true);
    expect(dptStateDiffers([dpt], conn(true))).toBe(false);
  });
  it('ignores USB readers and a missing state', () => {
    expect(dptStateDiffers([usb], conn(false))).toBe(false);
    expect(dptStateDiffers([dpt], null)).toBe(false);
  });
});

describe('readerTitle', () => {
  it('does not repeat the maker', () => {
    expect(readerTitle(dpt)).toBe('Sony DPT-RP1');
    expect(readerTitle(usb)).toBe('ONYX Tab X C');
    expect(readerTitle({ maker: 'Sony', name: 'Sony DPT-CP1' })).toBe('Sony DPT-CP1');
  });
});
