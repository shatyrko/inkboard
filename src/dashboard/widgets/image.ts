import { drawNote } from '../draw';
import type { DecodedImage } from '../data';
import type { WidgetDef } from './types';

/** a short fingerprint of a (possibly multi-megabyte) data URL, sampled so it stays cheap */
export function fingerprint(s: string): string {
  let h = 2166136261;
  const step = Math.max(1, Math.floor(s.length / 512));
  for (let i = 0; i < s.length; i += step) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return `${s.length.toString(36)}-${(h >>> 0).toString(36)}`;
}

/** Converts to gray and stretches the tones between the 1st and 99th percentile, so photos keep their contrast in the reader's 16 levels. */
function toGrayscale(canvas: HTMLCanvasElement): void {
  const g = canvas.getContext('2d', { willReadFrequently: true });
  if (!g) return;
  const img = g.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const histogram = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const y = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    d[i] = y;
    histogram[y]++;
  }
  const pixels = d.length / 4;
  const cut = (share: number) => { let n = 0; for (let v = 0; v < 256; v++) { n += histogram[v]; if (n >= pixels * share) return v; } return 255; };
  const lo = cut(0.01), hi = cut(0.99);
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = Math.max(0, Math.min(255, Math.round(((d[i] - lo) / span) * 255)));
  g.putImageData(img, 0, 0);
}

async function decodeImage(src: string, grayscale: boolean): Promise<DecodedImage> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const width = img.naturalWidth || img.width, height = img.naturalHeight || img.height;
  if (!grayscale) return { source: img, width, height };
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  if (!g) return { source: img, width, height };
  g.drawImage(img, 0, 0);
  try { toGrayscale(canvas); } catch { /* a tainted canvas cannot be read: keep the colours, the reader flattens them anyway */ }
  return { source: canvas, width, height };
}

export const imageWidget: WidgetDef<'image', DecodedImage> = {
  type: 'image',
  label: 'Image',
  icon: 'image',
  blurb: 'A picture, shown in grayscale',
  size: { w: 15, h: 12, minW: 2, minH: 2 },
  defaults: () => ({ src: '', name: '', fit: 'contain', grayscale: true, border: false }),
  fields: [
    { kind: 'image', key: 'src', label: 'Picture' },
    { kind: 'seg', key: 'fit', label: 'Fit', options: [{ value: 'contain', label: 'Whole picture' }, { value: 'cover', label: 'Fill and crop' }] },
    { kind: 'switch', key: 'grayscale', label: 'Grayscale and boost contrast', hint: 'Keeps photos punchy in the reader’s 16 grays.' },
    { kind: 'switch', key: 'border', label: 'Border' },
  ],
  source: (p) => p.src
    ? { key: `img:${p.grayscale ? 'g' : 'c'}:${fingerprint(p.src)}`, kind: 'image', load: () => decodeImage(p.src, p.grayscale) }
    : null,
  draw({ g, w, h, props, data }) {
    if (!props.src) return drawNote(g, w, h, 'Choose a picture');
    if (!data) return drawNote(g, w, h, 'Loading picture');
    if (!data.ok) return drawNote(g, w, h, 'Picture unavailable');
    const img = data.value;
    const scale = (props.fit === 'cover' ? Math.max : Math.min)(w / img.width, h / img.height);
    const dw = img.width * scale, dh = img.height * scale;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(img.source, (w - dw) / 2, (h - dh) / 2, dw, dh);
  },
};
