// The reader's own settings, with optimistic saving: a change shows at once, and if the reader refuses it the old value
// comes back together with a toast saying why.
import { ref } from 'vue';
import { api } from '../../lib/api';
import type { ConfigKey, DeviceConfig } from '../../lib/types';
import { notify } from '../../lib/ui';
import { CONFIG_FIELD, CONFIG_LABEL } from './options';

const message = (e: unknown) => (typeof e === 'string' ? e : (e as Error)?.message || 'Something went wrong.');

export function useReaderConfig() {
  const config = ref<DeviceConfig | null>(null);
  const error = ref('');

  async function load() {
    try {
      config.value = await api.deviceConfig();
      error.value = '';
    } catch (e) {
      error.value = message(e);
    }
  }

  async function save(key: ConfigKey, value: string) {
    const before = config.value;
    if (!before) return;
    const field = CONFIG_FIELD[key];
    if (before[field] === value) return;
    config.value = { ...before, [field]: value };
    try {
      await api.setConfig(key, value);
    } catch (e) {
      if (config.value) config.value = { ...config.value, [field]: before[field] };
      notify(`Could not change ${CONFIG_LABEL[key]}: ${message(e)}`, 'error');
    }
  }

  return { config, error, load, save };
}
