// Picks the interesting bit out of what a Web widget downloaded: a JSON path (a.b[0].c), then an optional regex.
// Errors are plain sentences because they end up next to the widget in the editor.

type Segment = string | number;

/** "a.b[0]['c d']" -> ["a", "b", 0, "c d"]; a leading "$" is allowed. Returns null for malformed paths. */
export function parsePath(path: string): Segment[] | null {
  const src = path.trim().replace(/^\$\.?/, '');
  const out: Segment[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '.') { i++; continue; }
    if (c === '[') {
      const end = src.indexOf(']', i);
      if (end < 0) return null;
      const inner = src.slice(i + 1, end).trim();
      const quoted = /^(['"])(.*)\1$/.exec(inner);
      if (quoted) out.push(quoted[2]);
      else if (/^-?\d+$/.test(inner)) out.push(Number(inner));
      else return null;
      i = end + 1;
      continue;
    }
    let j = i;
    while (j < src.length && src[j] !== '.' && src[j] !== '[') j++;
    out.push(src.slice(i, j));
    i = j;
  }
  return out;
}

export function getPath(value: unknown, path: string): unknown {
  const segments = parsePath(path);
  if (!segments) throw new Error(`"${path}" is not a valid path`);
  let cur: unknown = value;
  for (const s of segments) {
    if (typeof s === 'number') {
      if (!Array.isArray(cur)) throw new Error(`"${path}" not found`);
      cur = cur[s < 0 ? cur.length + s : s];
    } else {
      if (cur === null || typeof cur !== 'object' || !(s in cur)) throw new Error(`"${path}" not found`);
      cur = (cur as Record<string, unknown>)[s];
    }
    if (cur === undefined) throw new Error(`"${path}" not found`);
  }
  return cur;
}

export function stringify(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export type ExtractSpec = { path: string; regex: string };

export function extractValue(text: string, spec: ExtractSpec): string {
  let out = text;
  if (spec.path.trim()) {
    let json: unknown;
    try { json = JSON.parse(text); } catch { throw new Error('The response is not JSON'); }
    out = stringify(getPath(json, spec.path));
  }
  if (spec.regex.trim()) {
    let re: RegExp;
    try { re = new RegExp(spec.regex); } catch { throw new Error('The pattern is not a valid regular expression'); }
    const m = re.exec(out);
    if (!m) throw new Error('The pattern matched nothing');
    out = m[1] ?? m[0];
  }
  return out.trim();
}
