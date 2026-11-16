// From a dashboard to the reader: gather live data, render every page to 8-bit grayscale, hand the pixels to the Rust side.
// Nothing here aborts on a failing data source: that widget just draws "unavailable".
import { api } from '../lib/api';
import { adb, adbReady } from '../lib/adb';
import { capabilitiesWith } from '../lib/readers';
import type { AppSettings, LinkRect, PublishMeta, PublishPage, PublishResult } from '../lib/types';
import { emptyBag, fail, ok, type DataBag, type Source, type SourceKind } from './data';
import { ensureFonts, fontSample } from './fonts';
import { pageSize } from './grid';
import { pageLinks } from './links';
import type { Dashboard } from './model';
import { targetOf } from './publish-target';
import { renderPage, sourceOf } from './render';
import { renderSizeFor, type Size } from './resolution';

/** how long one source may take before its widget gives up (the Rust side has its own, shorter limits) */
const TIMEOUTS_MS: Record<SourceKind, number> = { system: 8_000, reader: 10_000, web: 15_000, command: 12_000, image: 10_000 };

export type CollectOptions = {
  /** AppSettings.allowCommands: when false, Command widgets get a "disabled" result instead of running */
  allowCommands: boolean;
  /** load only the sources this accepts (the editor skips network and commands until asked) */
  only?: (s: Source) => boolean;
  timeouts?: Partial<Record<SourceKind, number>>;
  now?: Date;
};

/** every distinct source the dashboard's widgets need */
export function collectSources(d: Dashboard): Source[] {
  const byKey = new Map<string, Source>();
  for (const page of d.pages) {
    for (const w of page.widgets) {
      const s = sourceOf(w);
      if (s && !byKey.has(s.key)) byKey.set(s.key, s);
    }
  }
  return [...byKey.values()];
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const limit = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out after ${Math.round(ms / 1000)} s`)), ms); });
  return Promise.race([p, limit]).finally(() => clearTimeout(timer));
}

/** loads sources in parallel, each with its own timeout; a failure becomes that source's error result */
export async function loadSources(sources: Source[], o: CollectOptions): Promise<DataBag['results']> {
  const results: DataBag['results'] = {};
  await Promise.all(sources.map(async (s) => {
    if (s.kind === 'command' && !o.allowCommands) {
      results[s.key] = fail('Commands are disabled in Settings', 'disabled');
      return;
    }
    try { results[s.key] = ok(await withTimeout(s.load(), o.timeouts?.[s.kind] ?? TIMEOUTS_MS[s.kind])); }
    catch (e) { results[s.key] = fail(e); }
  }));
  return results;
}

export async function collectData(d: Dashboard, o: CollectOptions): Promise<DataBag> {
  const sources = collectSources(d).filter((s) => o.only?.(s) ?? true);
  return { ...emptyBag(o.now), results: await loadSources(sources, o) };
}

// ---------- rendering to pixels ----------
/** 8-bit luma of RGBA pixels (weights 77/150/29 of 256, close to Rec. 601), written to `out` from `offset` */
export function lumaFromRgba(rgba: Uint8ClampedArray, out: Uint8Array, offset: number): void {
  for (let i = 0, n = rgba.length >> 2; i < n; i++) {
    out[offset + i] = (rgba[i * 4] * 77 + rgba[i * 4 + 1] * 150 + rgba[i * 4 + 2] * 29) >> 8;
  }
}

export type Rendered = { pixels: Uint8Array; pages: PublishPage[] };

/** link rectangles follow the page when it is rendered at another size than the standard one */
export function scaleLinks(links: LinkRect[], sx: number, sy: number): LinkRect[] {
  if (sx === 1 && sy === 1) return links;
  return links.map((l) => ({ ...l, x: Math.round(l.x * sx), y: Math.round(l.y * sy), w: Math.round(l.w * sx), h: Math.round(l.h * sy) }));
}

/**
 * Renders every page on its own canvas at `out` pixels (the standard 1650 x 2200, or 2200 x 1650, by default); devicePixelRatio
 * plays no part. A larger `out` scales the drawing itself, so everything stays sharp; memory is one page of RGBA at a time
 * plus the 8-bit result (a 2400 x 3200 page is 7.7 MB of it).
 */
export async function renderAllPages(d: Dashboard, data: DataBag, onPage?: (index: number, total: number) => void, out?: Size): Promise<Rendered> {
  await ensureFonts(fontSample(d, data));
  const page = pageSize(d.orientation);
  const { width, height } = out ?? page;
  const sx = width / page.width, sy = height / page.height;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  if (!g) throw new Error('The canvas could not be created');

  const pixels = new Uint8Array(width * height * d.pages.length);
  const pages: PublishPage[] = [];
  for (let i = 0; i < d.pages.length; i++) {
    onPage?.(i, d.pages.length);
    // let the progress text paint before the next (synchronous, ~100 ms) page render
    await new Promise((r) => setTimeout(r));
    g.setTransform(sx, 0, 0, sy, 0, 0);
    renderPage(g, d.pages[i], data, { width: page.width, height: page.height, dashboard: d, pageIndex: i });
    lumaFromRgba(g.getImageData(0, 0, width, height).data, pixels, i * width * height);
    pages.push({ width, height, links: scaleLinks(pageLinks(d, i), sx, sy) });
  }
  return { pixels, pages };
}

// ---------- publishing ----------
/** a name safe as a file name on the reader */
export function safeDocName(name: string): string {
  const n = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  return n || 'Dashboard';
}

export function buildMeta(d: Dashboard, pages: PublishPage[], settings: Pick<AppSettings, 'displayAfterPush'>): PublishMeta {
  const target = targetOf(d);
  // a USB reader has no "open on screen" and takes its folder from the target; the Digital Paper's meta stays as it always was
  if (target.kind === 'mtp') return { name: safeDocName(d.name), folder: '', display: false, pages, target };
  return {
    name: safeDocName(d.name),
    folder: d.publish?.folder?.trim() ?? '',
    display: d.publish?.display ?? settings.displayAfterPush,
    pages,
  };
}

export type Progress = { stage: 'data' | 'render' | 'upload'; page?: number; pages?: number };
export type PushOptions = { settings: AppSettings; onProgress?: (p: Progress) => void };

/** what a push returns: the saved file's result, and what happened when it was also shown on the reader */
export type Pushed = PublishResult & {
  /** shown on the reader's screen (USB readers with debugging on) */
  opened?: boolean;
  /** why showing it failed; the file is saved anyway */
  openError?: string;
};

/**
 * The file to show on a USB reader after pushing, or null when that is not wanted or not possible: it needs the reader's
 * debugging connection, the dashboard's "open after pushing" choice, and a format worth opening (a pen template is not).
 * Several PNG pages open the first one.
 */
export function fileToOpenAfterPush(d: Dashboard, result: PublishResult, ready: boolean, displayDefault: boolean): string | null {
  const t = targetOf(d);
  if (t.kind !== 'mtp' || t.format === 'template') return null;
  if (!capabilitiesWith('mtp', ready).openOnReader || !(d.publish?.display ?? displayDefault)) return null;
  return t.format === 'png' && result.pages > 1 ? `${result.path}/${safeDocName(d.name)} - 1.png` : result.path;
}

async function prepare(d: Dashboard, o: PushOptions, pictures: boolean): Promise<{ meta: PublishMeta; pixels: Uint8Array }> {
  o.onProgress?.({ stage: 'data' });
  const data = await collectData(d, { allowCommands: o.settings.allowCommands });
  const t = targetOf(d);
  // only pictures for a USB reader follow its screen; a PDF is always laid out at the standard size
  const size = pictures && t.kind === 'mtp' ? renderSizeFor(d, adb[t.readerId]?.screen) : undefined;
  const { pixels, pages } = await renderAllPages(d, data, (page, total) => o.onProgress?.({ stage: 'render', page: page + 1, pages: total }), size);
  return { meta: buildMeta(d, pages, o.settings), pixels };
}

export async function publishDashboard(d: Dashboard, o: PushOptions): Promise<Pushed> {
  const { meta, pixels } = await prepare(d, o, true);
  o.onProgress?.({ stage: 'upload' });
  const result = await api.publishDashboard(meta, pixels);
  return openOnReader(d, result, o.settings);
}

/** shows the pushed file on a USB reader whose debugging connection is open; a failure leaves the saved file alone */
async function openOnReader(d: Dashboard, result: PublishResult, settings: AppSettings): Promise<Pushed> {
  const t = targetOf(d);
  if (t.kind !== 'mtp') return result;
  const file = fileToOpenAfterPush(d, result, adbReady(t.readerId), settings.displayAfterPush);
  if (!file) return result;
  try {
    await api.adbOpen(t.readerId, file);
    return { ...result, opened: true };
  } catch (e) {
    return { ...result, openError: typeof e === 'string' ? e : (e as Error)?.message || 'The reader did not answer' };
  }
}

export async function exportDashboardPdf(d: Dashboard, dest: string, o: PushOptions): Promise<void> {
  const { meta, pixels } = await prepare(d, o, false);
  await api.exportDashboardPdf(meta, pixels, dest);
}

export function describeProgress(p: Progress): string {
  if (p.stage === 'data') return 'Fetching data';
  if (p.stage === 'render') return p.pages && p.pages > 1 ? `Rendering page ${p.page} of ${p.pages}` : 'Rendering';
  return 'Uploading';
}
