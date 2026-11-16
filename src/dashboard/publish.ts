// From a dashboard to the reader: gather live data, render every page to 8-bit grayscale, hand the pixels to the Rust side.
// Nothing here aborts on a failing data source: that widget just draws "unavailable".
import { api } from '../lib/api';
import type { AppSettings, PublishMeta, PublishPage, PublishResult } from '../lib/types';
import { emptyBag, fail, ok, type DataBag, type Source, type SourceKind } from './data';
import { ensureFonts, fontSample } from './fonts';
import { pageSize } from './grid';
import { pageLinks } from './links';
import type { Dashboard } from './model';
import { renderPage, sourceOf } from './render';

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

/** Renders every page at full size (1650 x 2200, or 2200 x 1650) on its own canvas; devicePixelRatio plays no part. */
export async function renderAllPages(d: Dashboard, data: DataBag, onPage?: (index: number, total: number) => void): Promise<Rendered> {
  await ensureFonts(fontSample(d, data));
  const { width, height } = pageSize(d.orientation);
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
    renderPage(g, d.pages[i], data, { width, height, dashboard: d, pageIndex: i });
    lumaFromRgba(g.getImageData(0, 0, width, height).data, pixels, i * width * height);
    pages.push({ width, height, links: pageLinks(d, i) });
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
  return {
    name: safeDocName(d.name),
    folder: d.publish?.folder?.trim() ?? '',
    display: d.publish?.display ?? settings.displayAfterPush,
    pages,
  };
}

export type Progress = { stage: 'data' | 'render' | 'upload'; page?: number; pages?: number };
export type PushOptions = { settings: AppSettings; onProgress?: (p: Progress) => void };

async function prepare(d: Dashboard, o: PushOptions): Promise<{ meta: PublishMeta; pixels: Uint8Array }> {
  o.onProgress?.({ stage: 'data' });
  const data = await collectData(d, { allowCommands: o.settings.allowCommands });
  const { pixels, pages } = await renderAllPages(d, data, (page, total) => o.onProgress?.({ stage: 'render', page: page + 1, pages: total }));
  return { meta: buildMeta(d, pages, o.settings), pixels };
}

export async function publishDashboard(d: Dashboard, o: PushOptions): Promise<PublishResult> {
  const { meta, pixels } = await prepare(d, o);
  o.onProgress?.({ stage: 'upload' });
  return api.publishDashboard(meta, pixels);
}

export async function exportDashboardPdf(d: Dashboard, dest: string, o: PushOptions): Promise<void> {
  const { meta, pixels } = await prepare(d, o);
  await api.exportDashboardPdf(meta, pixels, dest);
}

export function describeProgress(p: Progress): string {
  if (p.stage === 'data') return 'Fetching data';
  if (p.stage === 'render') return p.pages && p.pages > 1 ? `Rendering page ${p.page} of ${p.pages}` : 'Rendering';
  return 'Uploading';
}
