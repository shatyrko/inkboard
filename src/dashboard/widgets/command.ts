import { api } from '../../lib/api';
import { FILLS, PAD, SOFT_INK, drawFitted, drawLine, drawNote, measurer, roundRect } from '../draw';
import { MONO } from '../fonts';
import { clamp } from '../grid';
import { BOLD } from '../text';
import type { WidgetDef } from './types';

/** Output split into display lines: tabs become spaces, trailing blanks are dropped and long lines are hard-wrapped at `cols`. */
export function monoLines(output: string, cols: number): string[] {
  const width = Math.max(1, cols);
  const out: string[] = [];
  for (const raw of output.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').replace(/\s+$/, '').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line) { out.push(''); continue; }
    for (let i = 0; i < line.length; i += width) out.push(line.slice(i, i + width));
  }
  return out;
}

export const commandWidget: WidgetDef<'command', string> = {
  type: 'command',
  label: 'Command',
  icon: 'terminal',
  blurb: 'Output of a shell command',
  size: { w: 20, h: 10, minW: 5, minH: 3 },
  defaults: () => ({ command: '', title: '', size: 30, border: false }),
  normalize: (p) => ({ ...p, size: clamp(Math.round(p.size), 16, 120) }),
  fields: [
    { kind: 'text', key: 'command', label: 'Command', placeholder: 'e.g. uptime -p', mono: true, hint: 'Runs on every push, through your shell. Needs "Allow commands" in Settings.' },
    { kind: 'text', key: 'title', label: 'Title', placeholder: 'No title' },
    { kind: 'number', key: 'size', label: 'Text size', min: 16, max: 120, step: 2, unit: 'px' },
    { kind: 'switch', key: 'border', label: 'Border' },
  ],
  source: (p) => {
    const command = p.command.trim();
    return command ? { key: `cmd:${command}`, kind: 'command', load: () => api.runCommand(command) } : null;
  },
  manual: { label: 'Run now' },
  draw({ g, w, h, props: p, data }) {
    if (!p.command.trim()) return drawNote(g, w, h, 'Set a command');
    if (!data) return drawNote(g, w, h, 'Not run yet', 'Use Refresh data');
    if (!data.ok) return drawNote(g, w, h, data.code === 'disabled' ? 'Commands are disabled in Settings' : 'Command failed', data.code === 'disabled' ? undefined : data.error.split('\n')[0]);

    const left = PAD, room = w - PAD * 2;
    let top = PAD;
    if (p.title) {
      drawFitted(g, p.title, left, top + 20, room, { size: 36, weight: BOLD });
      top += 52;
    }
    const box = { x: left, y: top, w: room, h: h - top - PAD };
    g.fillStyle = FILLS.light!;
    roundRect(g, box.x, box.y, box.w, box.h, 16);
    g.fill();

    const pad = 18;
    const charW = measurer(g, MONO)('0', 500, p.size);
    const lineH = Math.round(p.size * 1.3);
    const lines = monoLines(data.value, Math.floor((box.w - pad * 2) / charW));
    const rows = Math.max(1, Math.floor((box.h - pad * 2) / lineH));
    const shown = lines.slice(0, rows);
    shown.forEach((text, i) => {
      const last = i === rows - 1 && lines.length > rows;
      drawLine(g, last ? text.slice(0, Math.max(0, text.length - 1)) + '…' : text, box.x + pad, box.y + pad + i * lineH + lineH / 2, { size: p.size, family: MONO, color: last ? SOFT_INK : undefined });
    });
  },
};
