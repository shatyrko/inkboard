// The dashboard document: what is stored by api.dashboardsSave and what the renderer and editor work on.
// Documents are treated as immutable by the editor (see ops.ts), so snapshots can be shared freely by the undo history.
import { clamp, clampRect, gridOf, type Bounds, type Orientation, type Rect } from './grid';
import { newId } from './ids';
import { registry, isWidgetType } from './widgets';
import type { AnyWidgetDef } from './widgets/types';

export type { Orientation };

// ---------- per-widget props ----------
export type Align = 'left' | 'center' | 'right';
export type Valign = 'top' | 'middle' | 'bottom';
export type ChecklistItem = { id: string; text: string; done: boolean };
export type SystemRow = 'cpu' | 'memory' | 'swap' | 'disk' | 'battery' | 'uptime' | 'load';
export type ReaderRow = 'battery' | 'pen' | 'storage';
export type FillLevel = 'none' | 'light' | 'medium' | 'dark' | 'black';

export interface WidgetProps {
  text: { text: string; size: number; align: Align; valign: Valign; border: boolean };
  clock: { show: 'both' | 'time' | 'date'; hour12: boolean; dateStyle: 'full' | 'long' | 'medium' | 'short'; timezone: string; label: string; align: Align; border: boolean };
  calendar: { weekStart: 'mon' | 'sun'; border: boolean };
  checklist: { title: string; items: ChecklistItem[]; size: number; border: boolean };
  countdown: { label: string; date: string; border: boolean };
  image: { src: string; name: string; fit: 'contain' | 'cover'; grayscale: boolean; border: boolean };
  system: { title: string; rows: SystemRow[]; border: boolean };
  reader: { title: string; rows: ReaderRow[]; border: boolean };
  web: { url: string; path: string; regex: string; prefix: string; suffix: string; caption: string; style: 'value' | 'text'; size: number; align: Align; border: boolean };
  command: { command: string; title: string; size: number; border: boolean };
  box: { shape: 'rect' | 'rounded' | 'line'; stroke: number; fill: FillLevel; radius: number };
  link: { label: string; /** "next", "prev", "first", "last" or a page id */ target: string; look: 'solid' | 'outline'; size: number };
  nav: { size: number };
}
export type WidgetType = keyof WidgetProps;

/** x, y, w, h are in grid cells; z orders overlapping widgets (higher is on top) */
export type Widget<T extends WidgetType = WidgetType> = {
  [K in T]: { id: string; type: K; x: number; y: number; w: number; h: number; z?: number; props: WidgetProps[K] };
}[T];

// ---------- document ----------
export type Page = { id: string; name: string; widgets: Widget[] };
export type Schedule = { enabled: boolean; everyMinutes: number };
export type PublishOptions = { folder?: string; display?: boolean };
export type Dashboard = {
  version: 1;
  id: string;
  name: string;
  /** ISO timestamp of the last save */
  updated: string;
  orientation: Orientation;
  pages: Page[];
  schedule?: Schedule;
  publish?: PublishOptions;
};

export function newPage(name: string, widgets: Widget[] = []): Page {
  return { id: newId(), name, widgets };
}

export function newDashboard(name: string, pages: Page[] = [newPage('Page 1')], orientation: Orientation = 'portrait'): Dashboard {
  return { version: 1, id: newId(), name, updated: new Date().toISOString(), orientation, pages };
}

/** a new widget of `type` with default props and size (any part of `at` overrides the position or size), clamped onto the page */
export function createWidget<T extends WidgetType>(type: T, bounds: Bounds, at: Partial<Rect> = {}, props?: Partial<WidgetProps[T]>, z = 0): Widget<T> {
  const def = registry[type];
  const r = clampRect({ x: at.x ?? 1, y: at.y ?? 1, w: at.w ?? def.size.w, h: at.h ?? def.size.h }, bounds, { w: def.size.minW, h: def.size.minH });
  return { id: newId(), type, ...r, z, props: { ...def.defaults(), ...props } } as Widget<T>;
}

// ---------- loading: tolerate anything a stored or hand-edited file might contain ----------
type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Fills `defaults` from `raw`, keeping only values of the right type, so a stale or hand-edited file cannot break drawing. */
export function coerceProps<P extends object>(defaults: P, raw: unknown): P {
  const src = isRecord(raw) ? raw : {};
  const out: Record<string, unknown> = { ...(defaults as Record<string, unknown>) };
  for (const [k, def] of Object.entries(defaults)) {
    const v = src[k];
    if (v === undefined) continue;
    if (typeof def === 'number') { if (typeof v === 'number' && Number.isFinite(v)) out[k] = v; }
    else if (Array.isArray(def)) { if (Array.isArray(v)) out[k] = v; }
    else if (typeof v === typeof def) out[k] = v;
  }
  return out as P;
}

function normalizeProps(def: AnyWidgetDef, raw: unknown): unknown {
  const props = coerceProps(def.defaults(), raw);
  return def.normalize ? def.normalize(props) : props;
}

function migrateWidget(raw: unknown, bounds: Bounds, seen: Set<string>): Widget | null {
  if (!isRecord(raw) || !isWidgetType(raw.type)) return null;
  const def = registry[raw.type];
  const r = clampRect(
    { x: num(raw.x, 0), y: num(raw.y, 0), w: num(raw.w, def.size.w), h: num(raw.h, def.size.h) },
    bounds, { w: def.size.minW, h: def.size.minH },
  );
  let id = str(raw.id, '');
  if (!id || seen.has(id)) id = newId();
  seen.add(id);
  const w: Json = { id, type: raw.type, ...r, props: normalizeProps(def, raw.props) };
  if (typeof raw.z === 'number' && Number.isFinite(raw.z)) w.z = raw.z;
  return w as Widget;
}

function migratePage(raw: unknown, index: number, bounds: Bounds, seen: Set<string>): Page {
  const src = isRecord(raw) ? raw : {};
  let id = str(src.id, '');
  if (!id || seen.has(id)) id = newId();
  seen.add(id);
  const ids = new Set<string>();
  const widgets = (Array.isArray(src.widgets) ? src.widgets : []).flatMap((w) => migrateWidget(w, bounds, ids) ?? []);
  return { id, name: str(src.name, `Page ${index + 1}`) || `Page ${index + 1}`, widgets };
}

/** Turns whatever was stored into a valid Dashboard (unknown widget types are dropped, numbers clamped, ids made unique). */
export function migrateDashboard(raw: unknown, fallbackId = newId()): Dashboard {
  const src = isRecord(raw) ? raw : {};
  const orientation: Orientation = src.orientation === 'landscape' ? 'landscape' : 'portrait';
  const bounds = gridOf(orientation);
  const seen = new Set<string>();
  const pages = (Array.isArray(src.pages) ? src.pages : []).map((p, i) => migratePage(p, i, bounds, seen));
  if (!pages.length) pages.push(newPage('Page 1'));

  const d: Dashboard = {
    version: 1,
    id: str(src.id, fallbackId) || fallbackId,
    name: str(src.name, 'Untitled dashboard') || 'Untitled dashboard',
    updated: Number.isNaN(Date.parse(str(src.updated, ''))) ? new Date().toISOString() : (src.updated as string),
    orientation,
    pages,
  };
  if (isRecord(src.schedule)) d.schedule = { enabled: src.schedule.enabled === true, everyMinutes: clamp(Math.round(num(src.schedule.everyMinutes, 30)), 1, 24 * 60) };
  if (isRecord(src.publish)) {
    const p: PublishOptions = {};
    if (typeof src.publish.folder === 'string' && src.publish.folder.trim()) p.folder = src.publish.folder.trim();
    if (typeof src.publish.display === 'boolean') p.display = src.publish.display;
    d.publish = p;
  }
  return d;
}
