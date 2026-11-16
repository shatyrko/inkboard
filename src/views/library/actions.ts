// What the library does to the reader: each action asks what it needs to ask, explains what is irreversible, calls the
// API, tells the user the outcome and reloads. Failures become toasts; nothing here throws.
import { api, pickFolder, pickSavePath } from '../../lib/api';
import { attempt, askDialog, chooseDialog, confirmDialog, notify } from '../../lib/ui';
import type { Entry } from '../../lib/types';
import { inTauri } from '../../lib/window';
import { fileName, listNames, partitionPdfs, pickPdfFiles } from '../shared/files';
import { plural } from '../shared/text';
import { deleteBody, deleteTitle, planDelete } from './deletion';
import { findByName, namesIn } from './listing';
import { joinPath, parentPath, splitExt, uniqueName, validateName } from './paths';
import type { FolderNode } from './tree';

export type ActionEnv = {
  entries: () => Entry[];
  reload: () => Promise<void>;
  askFolder: (o: { title: string; confirm: string; taken: ReadonlySet<string>; start: string }) => Promise<FolderNode | null>;
};

/** attempt() that says whether it worked */
async function run(fn: () => Promise<unknown>, failure: string): Promise<boolean> {
  return (await attempt(async () => { await fn(); return true; }, failure)) === true;
}

/** asks for a name until it is valid, explaining what was wrong in the dialog itself */
async function askName(o: { title: string; label: string; confirm: string; value?: string; suffix?: string; taken: string[] }): Promise<string | null> {
  let value = o.value ?? '';
  let problem = '';
  for (;;) {
    const v = await askDialog({ title: o.title, body: problem || undefined, label: o.label, value, confirm: o.confirm });
    if (v === null) return null;
    value = v.trim();
    problem = validateName(value + (o.suffix ?? ''), o.taken);
    if (!problem) return value;
  }
}

export function createActions(env: ActionEnv) {
  const isDoc = (e: Entry) => e.kind === 'document';

  async function openOnReader(e: Entry) {
    if (await run(() => api.libraryOpen(e.id), `Could not open "${e.name}" on the reader`)) notify(`Opened "${e.name}" on the reader`);
  }

  /** returns the new folder's path so the caller can go there */
  async function createFolder(parent: string): Promise<string | null> {
    const name = await askName({ title: 'New folder', label: 'Folder name', confirm: 'Create', taken: namesIn(env.entries(), parent) });
    if (!name) return null;
    const path = joinPath(parent, name);
    const ok = await run(() => api.libraryNewFolder(path), 'Could not create the folder');
    if (ok) notify(`Created the folder "${name}"`);
    await env.reload();
    return ok ? path : null;
  }

  async function rename(e: Entry) {
    if (!isDoc(e)) return;
    const { stem, ext } = splitExt(e.name);
    const taken = namesIn(env.entries(), parentPath(e.path)).filter((n) => n !== e.name);
    const next = await askName({ title: 'Rename', label: 'Name', confirm: 'Rename', value: stem, suffix: ext, taken });
    if (next === null || next + ext === e.name) return;
    if (await run(() => api.libraryMove(e.id, e.parentId, next + ext), 'Could not rename')) notify(`Renamed to "${next + ext}"`);
    await env.reload();
  }

  /** moves or copies documents to a folder picked from the tree; a name that is already taken there gets "(2)" */
  async function transfer(docs: Entry[], mode: 'move' | 'copy', here: string) {
    const verb = mode === 'move' ? 'Move' : 'Copy';
    const what = docs.length === 1 ? `"${docs[0].name}"` : plural(docs.length, 'document');
    const target = await env.askFolder({
      title: `${verb} ${what} to...`,
      confirm: `${verb} here`,
      taken: mode === 'move' ? new Set(docs.map((d) => parentPath(d.path))) : new Set(),
      start: here,
    });
    if (!target?.id) return;
    const targetId = target.id;
    const todo = mode === 'move' ? docs.filter((d) => parentPath(d.path) !== target.path) : docs;
    if (!todo.length) { notify('Already in that folder'); return; }

    const names = namesIn(env.entries(), target.path);
    let renamed = 0;
    let failed = false;
    for (const d of todo) {
      const name = uniqueName(d.name, names);
      const newName = name === d.name ? null : name;
      if (newName) renamed++;
      const call = () => (mode === 'move' ? api.libraryMove(d.id, targetId, newName) : api.libraryCopy(d.id, targetId, newName));
      if (!(await run(call, `Could not ${mode} "${d.name}"`))) { failed = true; break; }
      names.push(name);
    }
    if (!failed) {
      const done = todo.length === 1 ? `"${todo[0].name}"` : plural(todo.length, 'document');
      notify(`${mode === 'move' ? 'Moved' : 'Copied'} ${done} to ${target.name}${renamed ? ` (${renamed} renamed, the name was taken)` : ''}`);
    }
    await env.reload();
  }

  async function remove(picked: Entry[]) {
    const plan = planDelete(env.entries(), new Set(picked.map((p) => p.id)));
    const ok = await confirmDialog({ title: deleteTitle(plan, picked), body: deleteBody(plan), confirm: 'Delete permanently', danger: true });
    if (!ok) return;
    // the reader refuses a folder that still has content, so the plan lists documents first and deepest folders before their parents
    for (const step of plan.steps) {
      if (!(await run(() => api.libraryDelete(step.id, step.kind), `Could not delete "${step.name}"`))) { await env.reload(); return; }
    }
    const subject = picked.length === 1 ? `"${picked[0].name}"` : plural(picked.length, picked.every(isDoc) ? 'document' : 'item');
    notify(`Deleted ${subject}`);
    await env.reload();
  }

  async function download(docs: Entry[]) {
    // in a plain browser there is no save dialog: pretend one was answered so the transfer panel can be seen
    const demo = (name: string) => (inTauri ? null : `/demo/${name}`);
    if (docs.length === 1) {
      const d = docs[0];
      const dest = (await pickSavePath(d.name, ['pdf'])) ?? demo(d.name);
      if (!dest) return;
      if (await run(() => api.libraryDownload(d.id, dest), `Could not download "${d.name}"`)) notify(`Saved "${d.name}"`);
      return;
    }
    const dir = (await pickFolder('Save the documents in...')) ?? demo('');
    if (!dir) return;
    for (const d of docs) {
      if (!(await run(() => api.libraryDownload(d.id, joinPath(dir.replace(/\/$/, ''), d.name)), `Could not download "${d.name}"`))) return;
    }
    notify(`Saved ${plural(docs.length, 'document')}`);
  }

  /** Upload PDFs into a folder. Anything that is not a PDF is explained and left out; same-named documents are replaced only if the user agrees. */
  async function upload(paths: string[], folder: string) {
    const { pdfs, skipped } = partitionPdfs(paths);
    if (skipped.length) {
      const note = `The reader only opens PDF files, so ${listNames(skipped)} ${skipped.length === 1 ? 'was' : 'were'} left out. Convert EPUB, FB2 or MOBI books to PDF first, for example with Calibre.`;
      const go = await chooseDialog({
        title: skipped.length === 1 ? 'One file is not a PDF' : `${skipped.length} files are not PDFs`,
        body: note,
        buttons: pdfs.length
          ? [{ label: 'Cancel', value: 'cancel' }, { label: `Upload ${plural(pdfs.length, 'PDF')}`, value: 'go', kind: 'primary' }]
          : [{ label: 'OK', value: 'cancel', kind: 'primary' }],
      });
      if (go !== 'go') return;
    }

    let send = pdfs;
    const clashes = findByName(env.entries(), folder, pdfs.map(fileName));
    if (clashes.length) {
      const names = clashes.map((c) => c.name.toLowerCase());
      const choice = await chooseDialog({
        title: clashes.length === 1 ? `Replace "${clashes[0].name}"?` : `Replace ${clashes.length} documents?`,
        body: `${listNames(clashes.map((c) => c.name))} ${clashes.length === 1 ? 'is' : 'are'} already in ${folder}. Replacing deletes the version on the reader for good, together with anything written on it with the pen.`,
        buttons: [{ label: 'Cancel', value: 'cancel' }, { label: 'Skip existing', value: 'skip' }, { label: 'Replace', value: 'replace', kind: 'danger' }],
      });
      if (choice !== 'skip' && choice !== 'replace') return;
      if (choice === 'skip') send = pdfs.filter((p) => !names.includes(fileName(p).toLowerCase()));
      else for (const old of clashes) {
        if (!(await run(() => api.libraryDelete(old.id, 'document'), `Could not replace "${old.name}"`))) { await env.reload(); return; }
      }
    }
    if (!send.length) return;

    const results = await attempt(() => api.libraryUpload(send, folder), 'Upload failed');
    await env.reload();
    if (!results) return;
    const failed = results.filter((r) => !r.ok);
    const ok = results.length - failed.length;
    if (!failed.length) notify(`Uploaded ${plural(ok, 'document')}`);
    else notify(`${ok} of ${results.length} uploaded. "${failed[0].name}": ${failed[0].error ?? 'failed'}`, 'error');
  }

  async function uploadFromPicker(folder: string) {
    const paths = await pickPdfFiles('Upload PDF files');
    if (paths?.length) await upload(paths, folder);
  }

  return { openOnReader, createFolder, rename, transfer, remove, download, upload, uploadFromPicker };
}
