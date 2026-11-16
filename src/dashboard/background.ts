// Everything that happens to dashboards without the Dashboards view: the loaded documents, the one-at-a-time push lock,
// and the automatic pushes. It is a singleton started from App.vue, so a schedule fires whichever view is showing,
// even if the Dashboards view was never opened. The view reads its state (busy, "Next push in ...") and feeds it edits.
import { computed, ref, shallowReactive } from 'vue';
import { api } from '../lib/api';
import { app } from '../lib/store';
import type { PublishResult } from '../lib/types';
import { notify } from '../lib/ui';
import { listDashboards, loadDashboard } from './library';
import type { Dashboard } from './model';
import { publishDashboard, exportDashboardPdf, type Progress } from './publish';
import { PushScheduler, describeSchedule } from './schedule';

export type Busy = { id: string; progress: Progress };

/** what the engine needs from the outside; the real ones are below, tests pass fakes */
export type BackgroundDeps = {
  /** every stored dashboard, loaded and migrated */
  loadAll: () => Promise<Dashboard[]>;
  push: (d: Dashboard, onProgress: (p: Progress) => void) => Promise<PublishResult>;
  exportPdf: (d: Dashboard, dest: string, onProgress: (p: Progress) => void) => Promise<void>;
  /** automatic pushes only run while this is true */
  isConnected: () => boolean;
  /** called once per failing streak of automatic pushes, not on every failed attempt */
  onScheduledFailure: (d: Dashboard, message: string) => void;
  now?: () => number;
  tickMs?: number;
};

const messageOf = (e: unknown) => (typeof e === 'string' ? e : (e as Error)?.message || 'Something went wrong');
const fmtTime = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

export function createBackground(deps: BackgroundDeps) {
  const clock = deps.now ?? Date.now;
  /** every loaded dashboard; the one open in the editor is kept current by the view through put() */
  const docs = shallowReactive(new Map<string, Dashboard>());
  const busy = ref<Busy | null>(null);
  const changes = ref(0);
  /** the latest successful push, automatic or manual: what the reader may now be showing */
  const lastPush = ref<{ id: string; at: number } | null>(null);
  const now = ref(clock());
  /** dashboards whose last automatic push failed: the next failure stays quiet until one succeeds */
  const failing = new Set<string>();

  let lock: Promise<unknown> = Promise.resolve();
  /** one render and upload at a time, whether Publish was pressed or the schedule fired; busy shows which dashboard has the turn */
  function exclusive<T>(d: Dashboard, job: (onProgress: (p: Progress) => void) => Promise<T>): Promise<T> {
    const run = async () => {
      busy.value = { id: d.id, progress: { stage: 'data' } };
      try { return await job((progress) => { busy.value = { id: d.id, progress }; }); }
      finally { busy.value = null; }
    };
    const next = lock.then(run, run);
    lock = next.catch(() => {});
    return next;
  }

  const scheduler = new PushScheduler(async (id) => {
    const d = docs.get(id);
    if (!d) return;
    try {
      await exclusive(d, (onProgress) => deps.push(d, onProgress));
      failing.delete(id);
      lastPush.value = { id, at: clock() };
    } catch (e) {
      if (!failing.has(id)) {
        failing.add(id);
        deps.onScheduledFailure(d, messageOf(e));
      }
      throw e;
    }
  }, { now: clock, tickMs: deps.tickMs, onChange: () => { changes.value++; now.value = clock(); }, canRun: deps.isConnected });

  /** makes the schedule match the dashboards' own settings */
  function syncJobs() {
    scheduler.sync([...docs.values()].filter((d) => d.schedule?.enabled).map((d) => ({ id: d.id, everyMinutes: d.schedule!.everyMinutes })));
  }

  /** the latest version of a dashboard (after an edit, a rename, a new copy) */
  function put(d: Dashboard) {
    docs.set(d.id, d);
    syncJobs();
  }
  function remove(id: string) {
    docs.delete(id);
    syncJobs();
  }

  let loading: Promise<void> | null = null;
  /** loads every stored dashboard once; documents already in memory (possibly newer) are kept */
  function ensureLoaded(): Promise<void> {
    loading ??= deps.loadAll().then((all) => {
      for (const d of all) if (!docs.has(d.id)) docs.set(d.id, d);
      syncJobs();
    }).catch((e) => { loading = null; throw e; });
    return loading;
  }

  /** Publish pressed in the UI: shares the lock with automatic pushes and counts as a run for the schedule. Rejects on failure. */
  async function push(d: Dashboard): Promise<PublishResult> {
    try {
      const result = await exclusive(d, (onProgress) => deps.push(d, onProgress));
      failing.delete(d.id);
      lastPush.value = { id: d.id, at: clock() };
      scheduler.record(d.id, true);
      return result;
    } catch (e) {
      scheduler.record(d.id, false);
      throw e;
    }
  }

  const exportPdf = (d: Dashboard, dest: string) => exclusive(d, (onProgress) => deps.exportPdf(d, dest, onProgress));

  /** "Next push in 12 min · Last push 14:02 ok", empty when the dashboard has no schedule */
  function scheduleText(id: string): string {
    void changes.value;
    return docs.get(id)?.schedule?.enabled ? describeSchedule(scheduler.state(id), now.value, fmtTime) : '';
  }

  let tickClock: ReturnType<typeof setInterval> | undefined;
  /** Starts the automatic pushes. Safe to call again (on every reconnect): it only retries a failed load. */
  function start() {
    void ensureLoaded().catch(() => {});
    if (tickClock) return;
    scheduler.start();
    tickClock = setInterval(() => { now.value = clock(); }, 30_000);
  }
  function stop() {
    scheduler.stop();
    clearInterval(tickClock);
    tickClock = undefined;
  }

  return { docs, busy: computed(() => busy.value), lastPush: computed(() => lastPush.value), put, remove, ensureLoaded, push, exportPdf, scheduleText, start, stop };
}

export const background = createBackground({
  loadAll: async () => {
    const all: Dashboard[] = [];
    await Promise.all((await listDashboards()).map(async (e) => {
      try { all.push(await loadDashboard(e.id)); } catch { /* an unreadable file just has no schedule */ }
    }));
    return all;
  },
  push: async (d, onProgress) => publishDashboard(d, { settings: await currentSettings(), onProgress }),
  exportPdf: async (d, dest, onProgress) => exportDashboardPdf(d, dest, { settings: await currentSettings(), onProgress }),
  isConnected: () => !!app.conn?.connected,
  onScheduledFailure: (d, message) => notify(`Automatic push of "${d.name}" failed: ${message}. It will try again.`, 'error'),
});

async function currentSettings() {
  return app.settings ?? (await api.settingsGet());
}
