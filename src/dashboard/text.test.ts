import { describe, expect, it } from 'vitest';
import { ellipsize, fitFontSize, layoutMarkdown, parseInline, parseMarkdown, plainBlocks, wrapRuns, type Measure } from './text';

// every character is half an em wide: at size 10 a character is 5 px
const measure: Measure = (text, _weight, size) => text.length * size * 0.5;
const words = (lines: { runs: { text: string }[] }[]) => lines.map((l) => l.runs.map((r) => r.text).join(''));

describe('parseInline', () => {
  it('toggles bold between double asterisks', () => {
    expect(parseInline('a **b** c')).toEqual([{ text: 'a ', bold: false }, { text: 'b', bold: true }, { text: ' c', bold: false }]);
  });

  it('keeps an unmatched marker as text', () => {
    expect(parseInline('2 ** 3')).toEqual([{ text: '2 ** 3', bold: false }]);
    expect(parseInline('**x** and **y')).toEqual([{ text: 'x', bold: true }, { text: ' and **y', bold: false }]);
  });
});

describe('parseMarkdown', () => {
  it('recognises headings, bullets, paragraphs and blank lines', () => {
    const blocks = parseMarkdown('# Title\n## Sub\n- one\n* two\n\nplain **text**\r\n');
    expect(blocks.map((b) => b.kind)).toEqual(['h1', 'h2', 'li', 'li', 'blank', 'p', 'blank']);
    expect(blocks[0]).toEqual({ kind: 'h1', runs: [{ text: 'Title', bold: false }] });
  });

  it('does not treat a hash without a space as a heading', () => {
    expect(parseMarkdown('#tag')[0].kind).toBe('p');
  });
});

describe('wrapRuns', () => {
  const wrap = (text: string, width: number) => words(wrapRuns([{ text, bold: false }], width, 10, 500, measure));

  it('breaks lines at spaces', () => {
    expect(wrap('aaa bbb ccc', 30)).toEqual(['aaa', 'bbb', 'ccc']);
    expect(wrap('aa bb cc', 40)).toEqual(['aa bb cc']);
    expect(wrap('aa bb cc', 30)).toEqual(['aa bb', 'cc']);
  });

  it('splits a word that is wider than the line', () => {
    expect(wrap('abcdefghij', 30)).toEqual(['abcdef', 'ghij']);
  });

  it('measures bold runs by their own weight', () => {
    const heavy: Measure = (t, weight, size) => t.length * size * (weight >= 700 ? 1 : 0.5);
    const lines = wrapRuns([{ text: 'ab ', bold: false }, { text: 'cd', bold: true }], 1000, 10, 500, heavy);
    expect(lines[0].runs.map((r) => [r.text, r.x])).toEqual([['ab', 0], [' ', 10], ['cd', 15]]);
    expect(lines[0].width).toBe(35);
  });

  it('never leaves a trailing space on a line', () => {
    const lines = wrapRuns([{ text: 'aaa bbb', bold: false }], 18, 10, 500, measure);
    expect(lines[0].runs.at(-1)?.text).toBe('aaa');
    expect(lines[0].width).toBe(15);
  });
});

describe('layoutMarkdown', () => {
  it('stacks lines, sizes headings up and indents bullets', () => {
    const l = layoutMarkdown(parseMarkdown('# Big\n- item\nplain'), 1000, 20, measure);
    expect(l.lines.map((x) => x.size)).toEqual([31, 20, 20]);
    expect(l.lines[0].weight).toBe(700);
    expect(l.lines[1].bullet).toBe(0);
    expect(l.lines[1].runs[0].x).toBe(19);
    expect(l.lines[2].bullet).toBeNull();
    expect(l.lines[1].top).toBe(l.lines[0].top + l.lines[0].height);
    expect(l.height).toBe(l.lines[2].top + l.lines[2].height);
  });

  it('a blank line adds a gap and a wrapped bullet keeps its marker on the first line only', () => {
    const l = layoutMarkdown(parseMarkdown('a\n\n- bbbb cccc'), 60, 20, measure);
    expect(l.lines[1].top).toBeGreaterThan(l.lines[0].top + l.lines[0].height);
    expect(l.lines.filter((x) => x.bullet !== null)).toHaveLength(1);
    expect(l.lines).toHaveLength(3);
  });

  it('plainBlocks takes text literally', () => {
    expect(plainBlocks('# not a heading\n\nx')).toEqual([
      { kind: 'p', runs: [{ text: '# not a heading', bold: false }] }, { kind: 'blank' }, { kind: 'p', runs: [{ text: 'x', bold: false }] },
    ]);
  });
});

describe('ellipsize and fitFontSize', () => {
  it('leaves text that fits and trims text that does not', () => {
    expect(ellipsize('hello', 100, 500, 10, measure)).toBe('hello');
    expect(ellipsize('hello world', 30, 500, 10, measure)).toBe('hello…');
    expect(ellipsize('hello world', 5, 500, 10, measure)).toBe('…');
  });

  it('picks the largest size that fits the width and the height', () => {
    // 5 chars at 0.5 em: width at size s is 2.5 s
    expect(fitFontSize('hello', 700, 100, 1000, measure)).toBe(40);
    expect(fitFontSize('hello', 700, 1000, 62.5, measure, { lineHeight: 1.25 })).toBe(50);
    expect(fitFontSize('hello', 700, 1000, 1000, measure, { max: 64 })).toBe(64);
    expect(fitFontSize('hello', 700, 10, 10, measure, { min: 20 })).toBe(20);
  });
});
