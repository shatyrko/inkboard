// The library's data: the flat entry list as the reader reports it, and the folder tree derived from it.
import { computed, ref } from 'vue';
import { api } from '../../lib/api';
import type { Entry } from '../../lib/types';
import { buildTree } from './tree';

export function useLibrary() {
  const entries = ref<Entry[]>([]);
  const loading = ref(false);
  const loaded = ref(false);
  const error = ref('');
  const tree = computed(() => buildTree(entries.value));

  let running: Promise<void> | null = null;
  let again = false;

  /** A call during a load is not dropped (the data may already be stale): it queues one more load. */
  function load(): Promise<void> {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      loading.value = true;
      try {
        do {
          again = false;
          entries.value = await api.libraryList();
          error.value = '';
          loaded.value = true;
        } while (again);
      } catch (e) {
        error.value = typeof e === 'string' ? e : (e as Error)?.message || 'Could not read the library.';
      } finally {
        loading.value = false;
        running = null;
      }
    })();
    return running;
  }

  return { entries, loading, loaded, error, tree, load };
}
