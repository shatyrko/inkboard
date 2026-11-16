// What to tell the user after a batch of uploads.
import type { UploadResult } from '../../lib/types';
import { plural } from '../shared/text';

/** One sentence for the toast: how many went up, the first failure if any, and the first note about a file that went up with a catch. */
export function describeUpload(results: UploadResult[]): { text: string; failed: boolean } {
  const failed = results.filter((r) => !r.ok);
  const ok = results.length - failed.length;
  if (failed.length) return { text: `${ok} of ${results.length} uploaded. "${failed[0].name}": ${failed[0].error ?? 'failed'}`, failed: true };
  const noted = results.filter((r) => r.note);
  const base = `Uploaded ${plural(ok, 'document')}`;
  if (!noted.length) return { text: base, failed: false };
  const more = noted.length > 1 ? ` ${plural(noted.length - 1, 'other')} went up the same way.` : '';
  return { text: `${base}. "${noted[0].name}": ${noted[0].note}${more}`, failed: false };
}
