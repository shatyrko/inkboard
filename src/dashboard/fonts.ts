import type { DataBag } from './data';
import type { Dashboard } from './model';

// Font stacks and loading. The canvas only uses a webfont once it has loaded, so the renderer waits for the glyphs it needs.
export const SANS = `'Inter Variable', Inter, 'DejaVu Sans', sans-serif`;
export const MONO = `'JetBrains Mono', 'DejaVu Sans Mono', monospace`;

export const font = (weight: number, size: number, family = SANS) => `${weight} ${size}px ${family}`;

const WEIGHTS = [500, 600, 700];
const requested = new Set<string>();

let localeChars: string | null = null;
/** names of months and weekdays in the user's locale, so non-Latin calendars load the right glyph subset */
function localeSample(): string {
  if (localeChars !== null) return localeChars;
  const out: string[] = [];
  for (let i = 0; i < 12; i++) out.push(new Date(2024, i, 1).toLocaleDateString(undefined, { month: 'long' }));
  for (let i = 0; i < 7; i++) out.push(new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: 'long' }));
  return (localeChars = out.join(''));
}

/**
 * Loads the Inter weights the widgets use for every character in `sample` (Inter is split into per-script files,
 * so asking for the actual characters is what makes Cyrillic or accented text render in Inter and not a fallback).
 */
export async function ensureFonts(sample: string): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const chars = new Set(`0123456789 AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz:.,-/%•…✓${localeSample()}${sample}`);
  const jobs: Promise<unknown>[] = [];
  for (const weight of WEIGHTS) {
    const fresh = [...chars].filter((c) => !requested.has(`${weight}${c}`));
    if (!fresh.length) continue;
    fresh.forEach((c) => requested.add(`${weight}${c}`));
    jobs.push(document.fonts.load(font(weight, 32), fresh.join('')).catch(() => []));
  }
  await Promise.all(jobs);
}

/** every piece of text a dashboard can draw (names, widget props, fetched text), for ensureFonts; image data is left out */
export function fontSample(d: Dashboard, data: DataBag): string {
  const parts: string[] = [d.name];
  for (const page of d.pages) {
    parts.push(page.name);
    for (const w of page.widgets) {
      for (const [k, v] of Object.entries(w.props)) if (k !== 'src') parts.push(typeof v === 'string' ? v : JSON.stringify(v));
    }
  }
  for (const r of Object.values(data.results)) if (r.ok && typeof r.value === 'string') parts.push(r.value.slice(0, 20_000));
  return parts.join('');
}
