// Text matching shared by the library search and the searchable selects.

const SPECIAL: Record<string, string> = { ß: 'ss', ł: 'l', ø: 'o', đ: 'd', æ: 'ae', œ: 'oe', ı: 'i' };

/**
 * Lower case with accents removed ("Café" -> "cafe", "Ёлка" -> "елка"), so a search finds names whatever the keyboard layout.
 * The Cyrillic short i (й) keeps its breve: it is a letter of its own, not an accented и.
 */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/й/g, '')
    .replace(/[̀-ͯ]/g, '')
    .replace(//g, 'й')
    .replace(/[ßłøđæœı]/g, (c) => SPECIAL[c]);
}

/** the words of a query, folded; an empty list means "match everything" */
export function words(query: string): string[] {
  return fold(query).split(/\s+/).filter(Boolean);
}

/** every word must occur somewhere in the text */
export function matchesAll(text: string, needles: readonly string[]): boolean {
  if (!needles.length) return true;
  const hay = fold(text);
  return needles.every((n) => hay.includes(n));
}

/** "1 document", "3 documents" */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
