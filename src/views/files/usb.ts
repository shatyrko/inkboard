// What the USB reader reports about itself, in words for the Device view.

export type SpeedAdvice = { level: 'ok' | 'slow' | 'unknown'; text: string };

/** Mbit/s from "High speed (480 Mbit/s)" or "SuperSpeed (5 Gbit/s)"; null when the text has no figure */
function megabits(speed: string): number | null {
  const m = /([\d.]+)\s*(g|m)bit/i.exec(speed);
  return m ? Number(m[1]) * (m[2].toLowerCase() === 'g' ? 1000 : 1) : null;
}

/** below SuperSpeed (5 Gbit/s) a book is fine but a big transfer is slow, and a faster cable or port helps */
export function speedAdvice(speed: string | null): SpeedAdvice {
  if (!speed) return { level: 'unknown', text: 'The computer does not report the link speed.' };
  const rate = megabits(speed) ?? (/super/i.test(speed) ? 5000 : /high|full|low/i.test(speed) ? 480 : null);
  if (rate === null) return { level: 'unknown', text: 'The computer does not report the link speed.' };
  if (rate >= 5000) return { level: 'ok', text: 'A fast link: large transfers go quickly.' };
  return { level: 'slow', text: 'A faster cable or port makes transfers quicker. Books are small and fine as they are; large files take longer.' };
}

export type Usage = { used: number; pct: number };

export function usage(total: number, free: number): Usage {
  const used = Math.max(0, total - free);
  return { used, pct: total > 0 ? Math.min(100, (used / total) * 100) : 0 };
}
