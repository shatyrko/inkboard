// Stands in for what the reader is showing: a page of an invented book drawn on a canvas (3:4, like the real screen).
// The page number advances on every call so a refresh visibly does something.

const PARAGRAPHS = [
  'The lamp had been lit every evening for as long as anyone in the village could remember, and nobody thought to ask who had first decided that it should be. It was simply what the evening was for.',
  'Marta carried the oil up the spiral stairs in two tin cans, one in each hand, and counted the steps out of habit. There were ninety-one. On the ninety-first she always stopped, not from tiredness, but because the window there faced the sea.',
  'Some nights the water was the colour of slate and perfectly still. Other nights it moved like a living thing, and she kept the log with a steady hand: wind, visibility, the lights of passing ships, and once, a single rowing boat with no one in it.',
  'In the morning the village came down to the harbour and traded stories for bread. Hers were always the shortest. She had learned that most of what happens on a quiet coast can be told in a sentence, and that the rest is better left to the sea.',
  'The inspector arrived in October with a leather case and a list of questions. He asked about the lamp, the oil, the log, the stairs. He did not ask about the window on the ninety-first step, and she did not mention it.',
  'By winter the log filled three notebooks. She wrapped them in oilcloth and kept them under the bed, beside the tin cans, in case anyone should ever want to know what a lighthouse thinks about all night.',
  'When the storm came it came from the north, without warning, the way the old people had always said it would. The lamp turned, the glass hummed, and for eleven hours the whole coast depended on a small flame in a very large room.',
  'Afterwards the village was quiet. Boats lay on their sides in the shallows, and children walked along the tide line collecting what the water had left behind: rope, bottles, a painted wooden fish, a boot.',
];

let turn = 0;

function wrap(g: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && g.measureText(next).width > width) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** a PNG data URL */
export function mockScreenshot(): string {
  const W = 825;
  const H = 1100;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  if (!g) return '';
  const page = 117 + turn;
  const first = turn % PARAGRAPHS.length;
  turn++;

  g.fillStyle = '#f7f7f5';
  g.fillRect(0, 0, W, H);

  const margin = 90;
  const serif = "Georgia, 'Noto Serif', 'DejaVu Serif', serif";

  g.fillStyle = '#6a6a6a';
  g.font = `15px ${serif}`;
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';
  g.fillText('THE KEEPER’S ALMANAC', margin, 70);
  g.textAlign = 'right';
  g.fillText(`Chapter ${4 + Math.floor(page / 20) % 9}`, W - margin, 70);
  g.fillStyle = '#c8c8c4';
  g.fillRect(margin, 84, W - margin * 2, 1);

  g.textAlign = 'left';
  g.fillStyle = '#1c1c1c';
  g.font = `21px ${serif}`;
  const lineH = 33;
  let y = 150;
  for (let i = 0; y < H - 140; i++) {
    const para = PARAGRAPHS[(first + i) % PARAGRAPHS.length];
    const lines = wrap(g, para, W - margin * 2 - 28);
    lines.forEach((l, k) => {
      if (y >= H - 140) return;
      g.fillText(l, margin + (k === 0 ? 28 : 0), y);
      y += lineH;
    });
    y += 10;
  }

  g.fillStyle = '#6a6a6a';
  g.font = `15px ${serif}`;
  g.textAlign = 'center';
  g.fillText(String(page), W / 2, H - 56);

  return canvas.toDataURL('image/png');
}
