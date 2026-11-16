// What the file manager does to a USB reader: each action asks what it needs to ask, explains what is irreversible, calls
// the API, tells the user the outcome and reloads the folder. Failures become toasts; nothing here throws.
import { api, pickFolder, pickSavePath } from '../../lib/api';
import type { MtpEntry } from '../../lib/types';
import { attempt, chooseDialog, confirmDialog, notify } from '../../lib/ui';
import { inTauri } from '../../lib/window';
import { askName } from '../library/actions';
import { joinPath, splitExt } from '../library/paths';
import { fileName, listNames, pickAnyFiles } from '../shared/files';
import { plural } from '../shared/text';
import { deleteBody, deleteTitle } from './deletion';
import { sameNames } from './listing';
import { currentHandle, folderPath, type Crumb } from './nav';

export type MoveTarget = { parent: number | null; name: string; existing: MtpEntry[] };

export type ActionEnv = {
  readerId: () => string;
  storage: () => number;
  stack: () => Crumb[];
  /** everything in the folder being looked at, unfiltered */
  entries: () => MtpEntry[];
  reload: () => Promise<void>;
  askFolder: (moving: MtpEntry[]) => Promise<MoveTarget | null>;
};

/** attempt() that says whether it worked */
async function run(fn: () => Promise<unknown>, failure: string): Promise<boolean> {
  return (await attempt(async () => { await fn(); return true; }, failure)) === true;
}

export function createActions(env: ActionEnv) {
  const id = () => env.readerId();
  const storage = () => env.storage();
  const here = () => currentHandle(env.stack());

  /** returns the new folder's handle so the caller can select it */
  async function newFolder(): Promise<number | null> {
    const name = await askName({ title: 'New folder', label: 'Folder name', confirm: 'Create', taken: env.entries().map((e) => e.name) });
    if (!name) return null;
    let made: number | null = null;
    const ok = await run(async () => { made = await api.mtpNewFolder(id(), storage(), here(), name); }, 'Could not create the folder');
    if (ok) notify(`Created the folder "${name}"`);
    await env.reload();
    return ok ? made : null;
  }

  async function rename(e: MtpEntry) {
    // a file keeps its extension: the dialog asks for the name only
    const { stem, ext } = e.kind === 'file' ? splitExt(e.name) : { stem: e.name, ext: '' };
    const taken = env.entries().filter((x) => x.handle !== e.handle).map((x) => x.name);
    const next = await askName({ title: 'Rename', label: 'Name', confirm: 'Rename', value: stem, suffix: ext, taken });
    if (next === null || next + ext === e.name) return;
    if (await run(() => api.mtpRename(id(), storage(), e.handle, next + ext), 'Could not rename')) notify(`Renamed to "${next + ext}"`);
    await env.reload();
  }

  async function remove(list: MtpEntry[]) {
    const ok = await confirmDialog({ title: deleteTitle(list), body: deleteBody(list), confirm: 'Delete permanently', danger: true });
    if (!ok) return;
    for (const e of list) {
      // the reader deletes a folder with everything in it
      if (!(await run(() => api.mtpDelete(id(), storage(), e.handle), `Could not delete "${e.name}"`))) { await env.reload(); return; }
    }
    notify(`Deleted ${list.length === 1 ? `"${list[0].name}"` : plural(list.length, 'item')}`);
    await env.reload();
  }

  async function move(list: MtpEntry[]) {
    const target = await env.askFolder(list);
    if (!target) return;
    // MTP cannot rename on the way, so a name that is already taken there is left where it is
    const clashes = new Set(sameNames(target.existing, list.map((e) => e.name)).map((e) => e.name.toLowerCase()));
    const todo = list.filter((e) => !clashes.has(e.name.toLowerCase()));
    let moved = 0;
    for (const e of todo) {
      if (!(await run(() => api.mtpMove(id(), storage(), e.handle, target.parent), `Could not move "${e.name}"`))) { await env.reload(); return; }
      moved++;
    }
    const skipped = list.length - moved;
    if (!moved) notify(`Nothing moved: ${skipped === 1 ? 'that name is' : 'those names are'} already in ${target.name}`, 'error');
    else notify(`Moved ${moved === 1 ? `"${todo[0].name}"` : plural(moved, 'item')} to ${target.name}${skipped ? `, ${skipped} left because the name is taken there` : ''}`);
    await env.reload();
  }

  async function download(files: MtpEntry[]) {
    // in a plain browser there is no save dialog: pretend one was answered so the transfer panel can be seen
    const demo = (name: string) => (inTauri ? null : `/demo/${name}`);
    if (files.length === 1) {
      const f = files[0];
      const dest = (await pickSavePath(f.name)) ?? demo(f.name);
      if (!dest) return;
      if (await run(() => api.mtpDownload(id(), storage(), f.handle, dest), `Could not download "${f.name}"`)) notify(`Saved "${f.name}"`);
      return;
    }
    const dir = (await pickFolder('Save the files in...')) ?? demo('');
    if (!dir) return;
    for (const f of files) {
      if (!(await run(() => api.mtpDownload(id(), storage(), f.handle, joinPath(dir.replace(/\/$/, ''), f.name)), `Could not download "${f.name}"`))) return;
    }
    notify(`Saved ${plural(files.length, 'file')}`);
  }

  /** Upload into the folder being looked at. A same-named file is replaced only if the user agrees. */
  async function upload(paths: string[]) {
    let send = paths;
    const clashes = sameNames(env.entries(), paths.map(fileName)).filter((e) => e.kind === 'file');
    if (clashes.length) {
      const names = clashes.map((c) => c.name.toLowerCase());
      const where = folderPath(env.stack()) || env.stack()[0].name;
      const choice = await chooseDialog({
        title: clashes.length === 1 ? `Replace "${clashes[0].name}"?` : `Replace ${clashes.length} files?`,
        body: `${listNames(clashes.map((c) => c.name))} ${clashes.length === 1 ? 'is' : 'are'} already in ${where}. Replacing deletes the file on the reader for good.`,
        buttons: [{ label: 'Cancel', value: 'cancel' }, { label: 'Skip existing', value: 'skip' }, { label: 'Replace', value: 'replace', kind: 'danger' }],
      });
      if (choice !== 'skip' && choice !== 'replace') return;
      if (choice === 'skip') send = paths.filter((p) => !names.includes(fileName(p).toLowerCase()));
      else for (const old of clashes) {
        if (!(await run(() => api.mtpDelete(id(), storage(), old.handle), `Could not replace "${old.name}"`))) { await env.reload(); return; }
      }
    }
    if (!send.length) return;

    const results = await attempt(() => api.mtpUpload(id(), storage(), here(), send), 'Upload failed');
    await env.reload();
    if (!results) return;
    const failed = results.filter((r) => !r.ok);
    const ok = results.length - failed.length;
    if (!failed.length) notify(`Uploaded ${plural(ok, 'file')}`);
    else notify(`${ok} of ${results.length} uploaded. "${failed[0].name}": ${failed[0].error ?? 'failed'}`, 'error');
  }

  async function uploadFromPicker() {
    const paths = await pickAnyFiles('Upload files');
    if (paths?.length) await upload(paths);
  }

  return { newFolder, rename, remove, move, download, upload, uploadFromPicker };
}
