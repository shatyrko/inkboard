// Browser-only backend: answers the same commands as src-tauri with invented data, so the UI runs under `pnpm dev`
// in a plain browser (and can be screenshotted). Nothing here ever touches a real device.
import { handlers as device } from './device';
import { handlers as dashboards } from './dashboards';
import { handlers as mtp } from './mtp';

type Handler = (args: any) => unknown | Promise<unknown>;
const all: Record<string, Handler> = { ...device, ...dashboards, ...mtp };

export async function handle(cmd: string, args: Record<string, unknown>): Promise<unknown> {
  const fn = all[cmd];
  if (!fn) throw `mock: no handler for ${cmd}`;
  await new Promise((r) => setTimeout(r, 120)); // feel like a real round trip
  return fn(args);
}
