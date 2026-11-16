// Choices offered for the reader's settings, built so that whatever the reader currently reports is always among them
// (a value this app does not know is shown, never hidden).
import type { ConfigKey, DeviceConfig, WifiScanResult } from '../../lib/types';

export type Choice = { value: string; label: string };

export const CONFIG_FIELD: Record<ConfigKey, keyof DeviceConfig> = {
  date_format: 'dateFormat',
  time_format: 'timeFormat',
  timeout_to_standby: 'timeoutToStandby',
  timezone: 'timezone',
  owner: 'owner',
};

/** what the user calls each setting, for error messages */
export const CONFIG_LABEL: Record<ConfigKey, string> = {
  date_format: 'the date format',
  time_format: 'the time format',
  timeout_to_standby: 'auto standby',
  timezone: 'the time zone',
  owner: 'the owner name',
};

/** adds the current value as a choice when the list does not contain it */
function withCurrent(list: Choice[], current: string, label: (v: string) => string): Choice[] {
  return !current || list.some((c) => c.value === current) ? list : [...list, { value: current, label: label(current) }];
}

/** "M/d/yyyy" -> "Month/Day/Year" */
export function describePattern(pattern: string): string {
  const names: Record<string, string> = { yyyy: 'Year', MM: 'Month', M: 'Month', dd: 'Day', d: 'Day' };
  return pattern.replace(/yyyy|MM|M|dd|d/g, (t) => names[t]);
}

/** "M/d/yyyy" for 2026-03-07 -> "3/7/2026" */
export function formatWithPattern(pattern: string, date: Date): string {
  const pad = (n: number, w: number) => String(n).padStart(w, '0');
  const parts: Record<string, string> = {
    yyyy: String(date.getFullYear()),
    MM: pad(date.getMonth() + 1, 2),
    M: String(date.getMonth() + 1),
    dd: pad(date.getDate(), 2),
    d: String(date.getDate()),
  };
  return pattern.replace(/yyyy|MM|M|dd|d/g, (t) => parts[t]);
}

export function dateFormatChoices(current: string, now = new Date()): Choice[] {
  const label = (p: string) => `${describePattern(p)}  (${formatWithPattern(p, now)})`;
  return withCurrent(['yyyy/M/d', 'M/d/yyyy', 'd/M/yyyy'].map((p) => ({ value: p, label: label(p) })), current, label);
}

const STANDBY_MINUTES = [5, 10, 15, 30, 60];
const standbyLabel = (v: string) => (v === '0' ? 'Never' : Number(v) % 60 === 0 ? `${Number(v) / 60} hour${Number(v) === 60 ? '' : 's'}` : `${v} minutes`);

export function standbyChoices(current: string): Choice[] {
  return withCurrent(STANDBY_MINUTES.map((m) => ({ value: String(m), label: standbyLabel(String(m)) })), current, standbyLabel);
}

/** every IANA zone this engine knows; engines without Intl.supportedValuesOf get just the current one and UTC */
export function timeZoneChoices(current: string): Choice[] {
  const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  const ids = new Set(['UTC', ...supported]);
  const label = (id: string) => id.replace(/_/g, ' ');
  return withCurrent([...ids].sort().map((id) => ({ value: id, label: label(id) })), current, label);
}

/** a rough strength word for a signal in dBm */
export function signalLabel(dbm: number | null): string {
  if (dbm === null) return '';
  return dbm >= -55 ? 'Strong' : dbm >= -70 ? 'Good' : 'Weak';
}

/** one row per network name (access points of the same network repeat), strongest signal first, unnamed ones dropped */
export function strongestPerSsid(results: readonly WifiScanResult[]): WifiScanResult[] {
  const best = new Map<string, WifiScanResult>();
  for (const r of results) {
    if (!r.ssid) continue;
    const seen = best.get(r.ssid);
    if (!seen || (r.signal ?? -999) > (seen.signal ?? -999)) best.set(r.ssid, r);
  }
  return [...best.values()].sort((a, b) => (b.signal ?? -999) - (a.signal ?? -999));
}
