// Local file helpers: the reader only opens PDF, so everything that goes to it is checked here first.
import { pickFiles } from '../../lib/api';
import { inTauri } from '../../lib/window';

/** last path segment of a local path (either separator) */
export function fileName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
}

export function isPdf(path: string): boolean {
  return /\.pdf$/i.test(path);
}

/** splits dropped or picked paths into PDFs and everything else (folders land in `skipped` too) */
export function partitionPdfs(paths: readonly string[]): { pdfs: string[]; skipped: string[] } {
  const pdfs: string[] = [];
  const skipped: string[] = [];
  for (const p of paths) (isPdf(p) ? pdfs : skipped).push(p);
  return { pdfs, skipped };
}

/** "a.epub, b.fb2 and 3 more" */
export function listNames(paths: readonly string[], max = 4): string {
  const names = paths.map(fileName);
  if (names.length <= max) return names.join(', ');
  return `${names.slice(0, max).join(', ')} and ${names.length - max} more`;
}

/**
 * Native picker for PDFs. In a plain browser there is no picker, so two invented files stand in:
 * that lets the upload flow be exercised and screenshotted without the desktop shell.
 */
export async function pickPdfFiles(title: string, multiple = true): Promise<string[] | null> {
  const picked = await pickFiles({ title, multiple, extensions: ['pdf'] });
  if (picked || inTauri) return picked;
  const demo = ['/demo/Reading list.pdf', '/demo/Sketchbook scans.pdf'];
  return multiple ? demo : demo.slice(0, 1);
}
