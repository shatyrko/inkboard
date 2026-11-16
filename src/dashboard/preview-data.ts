// Live data for the editor preview. Computer and reader status and images load by themselves;
// web addresses and commands only on request, so typing a URL or a command never fires it on every keystroke.
import { shallowRef } from 'vue';
import { emptyBag, type DataBag, type Source } from './data';
import type { Dashboard } from './model';
import { collectSources, loadSources } from './publish';

const isManual = (s: Source) => s.kind === 'web' || s.kind === 'command';

export function usePreviewData(allowCommands: () => boolean) {
  const bag = shallowRef<DataBag>(emptyBag());
  const inflight = new Set<string>();

  /**
   * Loads what the preview is missing. `manual` also runs web and command sources; `force` reloads sources that
   * already have a result (status values go stale, images never do).
   */
  async function load(d: Dashboard, o: { manual?: boolean; force?: boolean; only?: string } = {}) {
    const wanted = collectSources(d).filter((s) => {
      if (o.only !== undefined && s.key !== o.only) return false;
      if (isManual(s) && !o.manual) return false;
      if (inflight.has(s.key)) return false;
      const have = s.key in bag.value.results;
      return !have || (o.force === true && s.kind !== 'image');
    });
    if (!wanted.length) return;
    wanted.forEach((s) => inflight.add(s.key));
    try {
      const results = await loadSources(wanted, { allowCommands: allowCommands() });
      bag.value = { now: new Date(), results: { ...bag.value.results, ...results } };
    } finally {
      wanted.forEach((s) => inflight.delete(s.key));
    }
  }

  return { bag, load };
}
