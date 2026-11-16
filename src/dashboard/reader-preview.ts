// The live "what is the reader showing" picture next to the page being edited. The refresh policy lives here, free of
// the DOM and of the view: it polls only while someone can see the result, never overlaps two screenshots, refreshes
// again shortly after a push (the reader needs a moment to draw) and complains once per failing streak.
import { ref } from 'vue';
import { api } from '../lib/api';
import type { PublishTarget } from '../lib/types';

export const POLL_MS = 5_000;
/** how long after a push the second refresh comes: the reader takes a moment to draw the new page */
export const SETTLE_MS = 3_000;
/** a screenshot that takes longer than this counts as failed, so one hung call cannot block every later refresh */
export const CAPTURE_TIMEOUT_MS = 15_000;

export type Conditions = {
  /** the Reader panel is on and on screen (not hidden behind the Properties tab) */
  panelVisible: boolean;
  /** the Dashboards view is the one showing (it stays mounted while other views are) */
  viewActive: boolean;
  windowVisible: boolean;
  connected: boolean;
};

/** polling makes sense only while all of these hold */
export const shouldPoll = (c: Conditions): boolean => c.panelVisible && c.viewActive && c.windowVisible && c.connected;

export type PreviewDeps = {
  /** a PNG data URL of the reader's screen */
  capture: () => Promise<string>;
  /** called once when a streak of failed screenshots starts, not on every failed attempt */
  onFailureStreak: (message: string) => void;
  now?: () => number;
  pollMs?: number;
  settleMs?: number;
  timeoutMs?: number;
};

const messageOf = (e: unknown) => (typeof e === 'string' ? e : (e as Error)?.message || 'The reader did not answer');

export function createReaderPreview(deps: PreviewDeps) {
  const clock = deps.now ?? Date.now;
  const image = ref<string | null>(null);
  const updatedAt = ref<number | null>(null);
  const loading = ref(false);
  /** why the last screenshot failed; the previous image stays in `image` */
  const error = ref('');

  let conditions: Conditions = { panelVisible: false, viewActive: false, windowVisible: true, connected: false };
  let poll: ReturnType<typeof setInterval> | undefined;
  let settle: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  let again = false;
  let failures = 0;

  async function capture() {
    inFlight = true;
    loading.value = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const limit = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('The reader did not answer in time')), deps.timeoutMs ?? CAPTURE_TIMEOUT_MS); });
      image.value = await Promise.race([deps.capture(), limit]);
      updatedAt.value = clock();
      error.value = '';
      failures = 0;
    } catch (e) {
      error.value = messageOf(e);
      if (failures++ === 0) deps.onFailureStreak(error.value);
    } finally {
      clearTimeout(timer);
      inFlight = false;
      loading.value = false;
      if (again) {
        again = false;
        if (shouldPoll(conditions)) void capture();
      }
    }
  }

  /** screenshot now; if one is already running, exactly one more follows it */
  function refresh() {
    if (!conditions.connected) return;
    if (inFlight) again = true;
    else void capture();
  }

  /** the periodic tick skips when busy instead of queueing */
  function tick() {
    if (!inFlight && shouldPoll(conditions)) void capture();
  }

  function stop() {
    clearInterval(poll);
    clearTimeout(settle);
    poll = settle = undefined;
  }

  /** tells the policy what changed; polling starts (with an immediate screenshot) or pauses as the conditions allow */
  function update(patch: Partial<Conditions>) {
    const was = shouldPoll(conditions);
    conditions = { ...conditions, ...patch };
    const now = shouldPoll(conditions);
    if (now && !was) {
      poll = setInterval(tick, deps.pollMs ?? POLL_MS);
      refresh();
    } else if (!now && was) {
      stop();
    }
  }

  /** a push finished: look right away, and once more when the reader has had time to draw */
  function afterPush() {
    if (!shouldPoll(conditions)) return;
    refresh();
    clearTimeout(settle);
    settle = setTimeout(() => {
      settle = undefined;
      if (shouldPoll(conditions)) refresh();
    }, deps.settleMs ?? SETTLE_MS);
  }

  /** the picture now comes from another reader: forget the old one and look again if anyone is watching */
  function reset() {
    image.value = null;
    updatedAt.value = null;
    error.value = '';
    failures = 0;
    refresh();
  }

  return { image, updatedAt, loading, error, update, refresh, afterPush, reset, dispose: stop };
}

/**
 * The real capture, from the reader the dashboard is published to: the Digital Paper over Wi-Fi, a USB reader over its
 * debugging connection. The screenshot is decoded before it is handed over, so swapping it in never flickers.
 */
export async function captureReaderScreen(target: PublishTarget): Promise<string> {
  const url = target.kind === 'mtp' ? await api.adbScreenshot(target.readerId) : await api.screenshot();
  const img = new Image();
  img.src = url;
  // a window that is not being drawn may never finish decoding: wait a moment at most
  await Promise.race([img.decode().catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);
  return url;
}

/** a base64 `data:` URL as a Blob; done by hand because the app's CSP does not let `fetch` read data URLs */
export function dataUrlToBlob(url: string): Blob {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
  if (!m) throw new Error('Not a data URL');
  const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] ?? 'application/octet-stream' });
}
