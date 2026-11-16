// The typefaces the "Type specimen" widget can show. They are bundled (src/typefaces.css), so a specimen looks the same on every
// computer; Inter, which the rest of the app is set in, is part of the list so the others can be compared with it.

export type TypefaceKind = 'serif' | 'sans' | 'mono' | 'dyslexia';
export type Typeface = {
  id: string;
  name: string;
  kind: TypefaceKind;
  /** the CSS font-family list the canvas uses */
  family: string;
};

export const KIND_LABEL: Record<TypefaceKind, string> = { serif: 'Serif', sans: 'Sans', mono: 'Monospace', dyslexia: 'Dyslexia-friendly' };

const face = (id: string, name: string, kind: TypefaceKind, css: string): Typeface => {
  const generic = kind === 'serif' ? 'serif' : kind === 'mono' ? 'monospace' : 'sans-serif';
  return { id, name, kind, family: `'${css}', ${generic}` };
};

export const TYPEFACES: Typeface[] = [
  face('literata', 'Literata', 'serif', 'Literata Variable'),
  face('merriweather', 'Merriweather', 'serif', 'Merriweather Variable'),
  face('source-serif', 'Source Serif 4', 'serif', 'Source Serif 4 Variable'),
  face('lora', 'Lora', 'serif', 'Lora Variable'),
  face('eb-garamond', 'EB Garamond', 'serif', 'EB Garamond Variable'),
  face('noto-serif', 'Noto Serif', 'serif', 'Noto Serif Variable'),
  face('crimson-pro', 'Crimson Pro', 'serif', 'Crimson Pro Variable'),
  face('pt-serif', 'PT Serif', 'serif', 'PT Serif'),

  face('inter', 'Inter', 'sans', 'Inter Variable'),
  face('roboto', 'Roboto', 'sans', 'Roboto Variable'),
  face('open-sans', 'Open Sans', 'sans', 'Open Sans Variable'),
  face('noto-sans', 'Noto Sans', 'sans', 'Noto Sans Variable'),
  face('source-sans', 'Source Sans 3', 'sans', 'Source Sans 3 Variable'),
  face('plex-sans', 'IBM Plex Sans', 'sans', 'IBM Plex Sans'),
  face('atkinson', 'Atkinson Hyperlegible Next', 'sans', 'Atkinson Hyperlegible Next Variable'),
  face('lexend', 'Lexend', 'sans', 'Lexend Variable'),

  face('jetbrains-mono', 'JetBrains Mono', 'mono', 'JetBrains Mono Variable'),
  face('plex-mono', 'IBM Plex Mono', 'mono', 'IBM Plex Mono'),

  face('opendyslexic', 'OpenDyslexic', 'dyslexia', 'OpenDyslexic'),
];

const byId = new Map(TYPEFACES.map((t) => [t.id, t]));
export const typefaceById = (id: string): Typeface | undefined => byId.get(id);

/** the ids of one kind, in list order */
export const idsOfKind = (kind: TypefaceKind): string[] => TYPEFACES.filter((t) => t.kind === kind).map((t) => t.id);

/** The first family name of a font-family list, unquoted: "'Lora Variable', serif" -> "Lora Variable". */
export const familyName = (family: string): string => family.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
