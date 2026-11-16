// Text layout for the Text, Checklist and Command widgets: a small markdown subset, word wrapping and ellipsis.
// Everything takes a `measure` callback instead of a canvas, so it is testable and the same code serves any renderer.

/** width in px of `text` set at `weight`/`size` */
export type Measure = (text: string, weight: number, size: number) => number;

export const REGULAR = 500; // a touch heavier than 400: thin strokes get lost on e-ink
export const BOLD = 700;

export type Inline = { text: string; bold: boolean };
export type Block = { kind: 'blank' } | { kind: 'p' | 'h1' | 'h2' | 'li'; runs: Inline[] };

/** **bold** toggles weight; an unmatched ** stays literal */
export function parseInline(src: string): Inline[] {
  const parts = src.split('**');
  if (parts.length % 2 === 0) parts.splice(parts.length - 2, 2, parts[parts.length - 2] + '**' + parts[parts.length - 1]);
  const out: Inline[] = [];
  parts.forEach((text, i) => { if (text) out.push({ text, bold: i % 2 === 1 }); });
  return out;
}

/** "# title", "## subtitle", "- bullet" (also "* " and a real bullet), blank lines, everything else is a paragraph */
export function parseMarkdown(src: string): Block[] {
  return src.replace(/\r\n?/g, '\n').split('\n').map((line): Block => {
    if (!line.trim()) return { kind: 'blank' };
    const h2 = /^##\s+(.*)$/.exec(line);
    if (h2) return { kind: 'h2', runs: parseInline(h2[1]) };
    const h1 = /^#\s+(.*)$/.exec(line);
    if (h1) return { kind: 'h1', runs: parseInline(h1[1]) };
    const li = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (li) return { kind: 'li', runs: parseInline(li[1]) };
    return { kind: 'p', runs: parseInline(line.trim()) };
  });
}

export type Placed = { text: string; weight: number; x: number };
export type Line = {
  runs: Placed[];
  size: number;
  weight: number;
  /** distance from the top of the layout */
  top: number;
  height: number;
  /** content width, for centring and right alignment */
  width: number;
  /** x of the bullet marker when the line starts a list item */
  bullet: number | null;
};
export type Layout = { lines: Line[]; height: number };

const LINE_HEIGHT = 1.3;

/** greedy word wrap of one paragraph; words wider than the line are split by characters */
export function wrapRuns(runs: Inline[], maxWidth: number, size: number, baseWeight: number, measure: Measure): { runs: Placed[]; width: number }[] {
  const lines: { runs: Placed[]; width: number }[] = [{ runs: [], width: 0 }];
  const room = Math.max(maxWidth, 1);
  const trimTail = () => {
    const last = lines[lines.length - 1];
    const tail = last.runs[last.runs.length - 1];
    if (tail && !tail.text.trim()) { last.runs.pop(); last.width = tail.x; } // never end a line with a space
  };
  const newLine = () => {
    trimTail();
    lines.push({ runs: [], width: 0 });
  };
  const place = (text: string, weight: number, width: number) => {
    const line = lines[lines.length - 1];
    line.runs.push({ text, weight, x: line.width });
    line.width += width;
  };

  for (const run of runs) {
    const weight = run.bold ? BOLD : baseWeight;
    for (const token of run.text.match(/\s+|\S+/g) ?? []) {
      const width = measure(token, weight, size);
      const line = lines[lines.length - 1];
      if (!token.trim()) {
        if (line.runs.length) place(' ', weight, measure(' ', weight, size));
        continue;
      }
      if (line.width + width > room && line.runs.length) newLine();
      if (width <= room) { place(token, weight, width); continue; }
      let chunk = '';
      for (const ch of token) {
        if (chunk && lines[lines.length - 1].width + measure(chunk + ch, weight, size) > room) {
          place(chunk, weight, measure(chunk, weight, size));
          newLine();
          chunk = '';
        }
        chunk += ch;
      }
      if (chunk) place(chunk, weight, measure(chunk, weight, size));
    }
  }
  trimTail();
  return lines;
}

/** Sets parsed markdown into lines: headings are larger and bold, bullets are indented, blank lines add a gap. */
export function layoutMarkdown(blocks: Block[], width: number, base: number, measure: Measure): Layout {
  const lines: Line[] = [];
  let y = 0;
  const gap = Math.round(base * 0.45);
  blocks.forEach((b, i) => {
    if (b.kind === 'blank') { y += gap; return; }
    const heading = b.kind === 'h1' || b.kind === 'h2';
    const size = b.kind === 'h1' ? Math.round(base * 1.55) : b.kind === 'h2' ? Math.round(base * 1.25) : base;
    const weight = heading ? BOLD : REGULAR;
    const indent = b.kind === 'li' ? Math.round(base * 0.95) : 0;
    if (heading && i > 0 && blocks[i - 1].kind !== 'blank') y += Math.round(base * 0.25);
    const wrapped = wrapRuns(b.runs, width - indent, size, weight, measure);
    const height = Math.round(size * LINE_HEIGHT);
    wrapped.forEach((l, n) => {
      lines.push({
        runs: l.runs.map((r) => ({ ...r, x: r.x + indent })),
        size, weight, top: y, height, width: l.width + indent,
        bullet: b.kind === 'li' && n === 0 ? 0 : null,
      });
      y += height;
    });
  });
  return { lines, height: y };
}

/** the longest prefix of `text` that fits with a trailing ellipsis; `text` itself when it fits */
export function ellipsize(text: string, maxWidth: number, weight: number, size: number, measure: Measure): string {
  if (measure(text, weight, size) <= maxWidth) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(text.slice(0, mid).trimEnd() + '…', weight, size) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo).trimEnd() + '…';
}

/** the largest whole font size at which `text` fits one line in `maxWidth` x `maxHeight`, within [min, max] */
export function fitFontSize(text: string, weight: number, maxWidth: number, maxHeight: number, measure: Measure, o: { min?: number; max?: number; lineHeight?: number } = {}): number {
  const perPx = measure(text, weight, 100) / 100;
  const byWidth = perPx > 0 ? maxWidth / perPx : Infinity;
  const size = Math.floor(Math.min(byWidth, maxHeight / (o.lineHeight ?? 1.1), o.max ?? Infinity));
  return Math.max(o.min ?? 12, size);
}

/** Fetched or command text taken literally (no markdown): one paragraph per line, blank lines kept. */
export function plainBlocks(src: string): Block[] {
  return src.replace(/\r\n?/g, '\n').trim().split('\n').map((line): Block => (line.trim() ? { kind: 'p', runs: [{ text: line.trim(), bold: false }] } : { kind: 'blank' }));
}
