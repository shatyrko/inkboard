import { describe, expect, it } from 'vitest';
import { dateFormatChoices, describePattern, formatWithPattern, signalLabel, standbyChoices, strongestPerSsid, timeZoneChoices } from './options';

const day = new Date(2026, 2, 7); // 7 March 2026

describe('date formats', () => {
  it('describes a pattern in words', () => {
    expect(describePattern('M/d/yyyy')).toBe('Month/Day/Year');
    expect(describePattern('dd.MM.yyyy')).toBe('Day.Month.Year');
  });
  it('shows an example for today', () => {
    expect(formatWithPattern('M/d/yyyy', day)).toBe('3/7/2026');
    expect(formatWithPattern('yyyy/M/d', day)).toBe('2026/3/7');
    expect(formatWithPattern('dd.MM.yyyy', day)).toBe('07.03.2026');
  });
  it('lists the known formats and keeps an unknown current one', () => {
    expect(dateFormatChoices('d/M/yyyy', day).map((c) => c.value)).toEqual(['yyyy/M/d', 'M/d/yyyy', 'd/M/yyyy']);
    const odd = dateFormatChoices('dd.MM.yyyy', day);
    expect(odd.at(-1)).toEqual({ value: 'dd.MM.yyyy', label: 'Day.Month.Year  (07.03.2026)' });
  });
});

describe('standby choices', () => {
  it('offers sensible values with readable labels', () => {
    const c = standbyChoices('10');
    expect(c.map((x) => x.label)).toEqual(['5 minutes', '10 minutes', '15 minutes', '30 minutes', '1 hour']);
  });
  it('adds the current value when it is not on the list', () => {
    expect(standbyChoices('20').at(-1)).toEqual({ value: '20', label: '20 minutes' });
    expect(standbyChoices('0').at(-1)).toEqual({ value: '0', label: 'Never' });
    expect(standbyChoices('120').at(-1)).toEqual({ value: '120', label: '2 hours' });
  });
});

describe('time zones', () => {
  it('always contains UTC and the current zone, once each', () => {
    const c = timeZoneChoices('Mars/Olympus_Mons');
    expect(c.some((x) => x.value === 'UTC')).toBe(true);
    expect(c.filter((x) => x.value === 'Mars/Olympus_Mons')).toHaveLength(1);
    expect(c.find((x) => x.value === 'Mars/Olympus_Mons')!.label).toBe('Mars/Olympus Mons');
  });
});

describe('signalLabel', () => {
  it('maps dBm to a word', () => {
    expect(signalLabel(-48)).toBe('Strong');
    expect(signalLabel(-63)).toBe('Good');
    expect(signalLabel(-80)).toBe('Weak');
    expect(signalLabel(null)).toBe('');
  });
});

describe('strongestPerSsid', () => {
  it('keeps the strongest access point of each network, strongest first, and drops hidden names', () => {
    const list = strongestPerSsid([
      { ssid: 'Home', security: 'psk', signal: -70 },
      { ssid: 'Cafe', security: 'nonsec', signal: -50 },
      { ssid: 'Home', security: 'psk', signal: -55 },
      { ssid: '', security: 'psk', signal: -40 },
      { ssid: 'Far', security: 'psk', signal: null },
    ]);
    expect(list.map((n) => `${n.ssid}:${n.signal}`)).toEqual(['Cafe:-50', 'Home:-55', 'Far:null']);
  });
});
