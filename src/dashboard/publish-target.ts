// Which reader a dashboard is published to, and the small decisions around it. Pure: the readers list comes in as an argument.
import { fmtBytes } from '../lib/format';
import { capabilities, readerTitle } from '../lib/readers';
import type { PublishResult, PublishTarget, Reader, ReaderKind } from '../lib/types';
import type { Dashboard, PublishOptions } from './model';

export const DPT_ID = 'dpt';
export const DPT_TARGET: PublishTarget = { kind: 'dpt' };

export type TargetFields = Pick<PublishOptions, 'target' | 'targetName'>;

/** the dashboard's target; the Digital Paper when it has none */
export const targetOf = (d: Dashboard | null | undefined): PublishTarget => d?.publish?.target ?? DPT_TARGET;

/** Reader.id of the target */
export const targetReaderId = (t: PublishTarget): string => (t.kind === 'mtp' ? t.readerId : DPT_ID);

export const kindOfTarget = (t: PublishTarget): ReaderKind => (t.kind === 'mtp' ? 'mtp' : 'digital-paper');

/** where the reader puts a file when the folder is left empty (the Rust side applies the same defaults) */
export const defaultFolder = (format: 'pdf' | 'png'): string => (format === 'png' ? 'Pictures/Inkboard' : 'Documents/Inkboard');

/** The target a new dashboard starts with: the reader the app is showing right now. */
export function targetFor(reader: Reader | null): TargetFields {
  if (reader?.kind !== 'mtp') return { target: DPT_TARGET };
  return { target: { kind: 'mtp', readerId: reader.id, folder: '', format: capabilities('mtp').dashboardFormats[0] }, targetName: reader.name };
}

/**
 * Can a push to `target` go out right now? The reader's own entry decides; the Digital Paper also counts as reachable
 * while its Wi-Fi session is alive, which keeps working when the readers list has not been loaded yet.
 */
export function isTargetReachable(target: PublishTarget, readers: Reader[], dptConnected: boolean): boolean {
  const id = targetReaderId(target);
  const entry = readers.find((r) => r.id === id);
  return !!entry?.connected || (id === DPT_ID && dptConnected);
}

export type TargetOption = { id: string; label: string };

/**
 * The "Publish to" choices: the readers that are connected, plus the current target even when it is not, so a setting
 * for a reader that is unplugged right now stays visible instead of silently turning into another reader.
 */
export function targetOptions(readers: Reader[], current: PublishTarget, o: { rememberedName?: string; dptConnected: boolean }): TargetOption[] {
  const currentId = targetReaderId(current);
  const options = readers
    .filter((r) => r.connected || r.id === currentId)
    .map((r) => ({ id: r.id, label: r.connected ? readerTitle(r) : `${readerTitle(r)} (not connected)` }));
  if (!options.some((x) => x.id === currentId)) {
    const name = current.kind === 'dpt' ? 'Digital Paper' : o.rememberedName || 'USB reader';
    options.push({ id: currentId, label: current.kind === 'dpt' && o.dptConnected ? name : `${name} (not connected)` });
  }
  return options;
}

/** The target fields after choosing reader `id`; choosing the reader that is already the target keeps its folder and format. */
export function retarget(id: string, readers: Reader[], previous: PublishTarget): TargetFields {
  if (id === DPT_ID) return { target: DPT_TARGET };
  const reader = readers.find((r) => r.id === id);
  if (previous.kind === 'mtp' && previous.readerId === id) return { target: previous, ...(reader ? { targetName: reader.name } : {}) };
  return reader ? targetFor(reader) : { target: previous };
}

/** what to call the target reader in messages: its current name, else the remembered one */
export function targetName(d: Dashboard, readers: Reader[]): string {
  const target = targetOf(d);
  const entry = readers.find((r) => r.id === targetReaderId(target));
  if (entry) return target.kind === 'mtp' ? entry.name : readerTitle(entry);
  return target.kind === 'mtp' ? d.publish?.targetName || 'the USB reader' : 'the Digital Paper';
}

/** the toast after a successful push: where it went, and never a claim that it was opened on a USB reader */
export function describePushed(d: Dashboard, result: PublishResult, readers: Reader[]): string {
  const target = targetOf(d);
  if (target.kind === 'dpt') {
    return `Published "${d.name}" to ${result.path} (${result.pages} ${result.pages === 1 ? 'page' : 'pages'}, ${fmtBytes(result.bytes)})`;
  }
  const where = `${result.path} on ${targetName(d, readers)}`;
  return target.format === 'png' && result.pages > 1 ? `Saved ${result.pages} images to ${where}` : `Saved to ${where}`;
}
