// USB debugging (ADB) state of the USB readers, shared by every view that offers more when it is on.
import { reactive } from 'vue';
import { api } from './api';
import type { AdbStatus } from './types';

const NONE: AdbStatus = { state: 'unavailable', android: null, battery: null, screen: null };

/** last known status by Reader.id; undefined until the first refresh */
export const adb = reactive<Record<string, AdbStatus | undefined>>({});
/** true while a connection attempt is waiting for the user to approve on the reader */
export const adbConnecting = reactive<Record<string, boolean>>({});

export const adbReady = (id: string | null | undefined): boolean => !!id && adb[id]?.state === 'ready';

/** Reads the status without prompting anything on the reader; a failure counts as unavailable. */
export async function refreshAdb(id: string): Promise<AdbStatus> {
  try {
    adb[id] = await api.adbStatus(id);
  } catch {
    adb[id] = NONE;
  }
  return adb[id]!;
}

/** Connects (the reader asks the user to approve); throws the reader's message when it fails. */
export async function connectAdb(id: string): Promise<AdbStatus> {
  adbConnecting[id] = true;
  try {
    adb[id] = await api.adbConnect(id);
    return adb[id]!;
  } finally {
    adbConnecting[id] = false;
  }
}

export async function disconnectAdb(id: string): Promise<void> {
  await api.adbDisconnect(id).catch(() => {});
  await refreshAdb(id);
}
