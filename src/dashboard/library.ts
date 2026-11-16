// Dashboard files through the API: listing, loading (always migrated), saving, copies and samples.
import { api } from '../lib/api';
import { activeReader } from '../lib/store';
import type { DashboardSummary } from '../lib/types';
import { newId } from './ids';
import { migrateDashboard, type Dashboard } from './model';
import { targetFor } from './publish-target';
import type { Sample } from './samples';

/** the list's order: by name, ignoring case and accents */
export const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

export async function listDashboards(): Promise<DashboardSummary[]> {
  return [...(await api.dashboardsList())].sort(byName);
}

export async function loadDashboard(id: string): Promise<Dashboard> {
  return migrateDashboard(await api.dashboardsLoad(id), id);
}

/** stamps the save time and stores the document; returns what was stored */
export async function saveDashboard(d: Dashboard): Promise<Dashboard> {
  const stamped = { ...d, updated: new Date().toISOString() };
  await api.dashboardsSave(stamped);
  return stamped;
}

/** "Daily" -> "Daily 2" when "Daily" is taken */
export function uniqueName(base: string, taken: string[]): string {
  const used = new Set(taken.map((n) => n.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!used.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}

export async function createFromSample(sample: Sample, taken: string[]): Promise<Dashboard> {
  const d = sample.make(uniqueName(sample.id === 'blank' ? 'New dashboard' : sample.label, taken));
  // a new dashboard goes to the reader the app is showing right now, in the file format the sample is made for (when that reader takes it)
  const to = targetFor(activeReader());
  const target = to.target?.kind === 'mtp' && sample.format ? { ...to, target: { ...to.target, format: sample.format } } : to;
  return saveDashboard({ ...d, publish: { ...d.publish, ...target } });
}

/** a separate document with the same pages (page and widget ids may repeat: they only need to be unique within one document) */
export async function duplicateDashboard(source: Dashboard, taken: string[]): Promise<Dashboard> {
  return saveDashboard({ ...source, id: newId(), name: uniqueName(`${source.name} copy`, taken) });
}

export const deleteDashboard = (id: string) => api.dashboardsDelete(id);
