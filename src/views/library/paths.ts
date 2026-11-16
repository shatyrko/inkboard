// Path and name helpers for the reader's library. Remote paths always use "/" and start with the root folder.

/** everything on the reader lives under this folder */
export const ROOT = 'Document';

export function parentPath(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function joinPath(...parts: string[]): string {
  return parts.filter(Boolean).join('/');
}

/** true for the folder itself and for anything below it */
export function isInside(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`);
}

/** the folders from the root down to `path` (inclusive), for breadcrumbs and for expanding the tree */
export function trail(path: string): { name: string; path: string }[] {
  const out: { name: string; path: string }[] = [];
  let acc = '';
  for (const seg of path.split('/').filter(Boolean)) {
    acc = acc ? `${acc}/${seg}` : seg;
    out.push({ name: seg, path: acc });
  }
  return out;
}

/** path without the root, as shown in the search results ("Books/Poetry") */
export function relativeToRoot(path: string): string {
  return path === ROOT ? '' : path.startsWith(`${ROOT}/`) ? path.slice(ROOT.length + 1) : path;
}

/** "report.final.pdf" -> stem "report.final", ext ".pdf"; only a short alphanumeric tail counts as an extension */
export function splitExt(name: string): { stem: string; ext: string } {
  const m = /\.[A-Za-z0-9]{1,5}$/.exec(name);
  return m && m.index > 0 ? { stem: name.slice(0, m.index), ext: m[0] } : { stem: name, ext: '' };
}

/** '' when the name is fine, otherwise a sentence for the user */
export function validateName(name: string, taken: Iterable<string> = []): string {
  const n = name.trim();
  if (!n) return 'Type a name.';
  if (/[\\/\u0000-\u001f]/.test(n)) return 'A name cannot contain slashes.';
  if (n === '.' || n === '..') return 'That name is not allowed.';
  if (n.length > 200) return 'That name is too long.';
  const lower = n.toLowerCase();
  for (const t of taken) if (t.toLowerCase() === lower) return 'That name is already taken here.';
  return '';
}

/** "a.pdf" -> "a (2).pdf" when "a.pdf" is taken, then (3) ... */
export function uniqueName(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((t) => t.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  const { stem, ext } = splitExt(name);
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/** user-typed folder -> reader path, always below the root ("dash" -> "Document/dash", "document\\a//b/" -> "Document/a/b") */
export function normaliseFolder(input: string): string {
  const parts = input.replace(/\\/g, '/').split('/').map((s) => s.trim()).filter(Boolean);
  if (parts[0]?.toLowerCase() === ROOT.toLowerCase()) parts[0] = ROOT;
  else parts.unshift(ROOT);
  return parts.join('/');
}
