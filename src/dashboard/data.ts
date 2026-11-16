// What widgets read besides their own props: live data fetched before a page is drawn.
// Drawing itself stays synchronous and pure; everything asynchronous (stats, downloads, image decoding) happens in a Source.

export type Result<T> = { ok: true; value: T } | { ok: false; error: string; code?: 'disabled' };

export type SourceKind = 'system' | 'reader' | 'web' | 'command' | 'image';

/** One thing to load. Widgets that ask for the same `key` share a single load. */
export interface Source<D = unknown> {
  key: string;
  kind: SourceKind;
  load: () => Promise<D>;
}

export interface DataBag {
  /** the moment this bag was gathered; clocks, calendars and countdowns draw from it */
  now: Date;
  results: Record<string, Result<unknown>>;
}

export const emptyBag = (now = new Date()): DataBag => ({ now, results: {} });

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = (e: unknown, code?: 'disabled'): Result<never> => ({
  ok: false,
  error: typeof e === 'string' ? e : (e as Error)?.message || 'Unavailable',
  ...(code ? { code } : {}),
});

/** a decoded image, ready to draw */
export type DecodedImage = { source: CanvasImageSource; width: number; height: number };
