import { describe, expect, it, vi } from 'vitest';
import type { Source } from './data';
import { buildMeta, collectSources, lumaFromRgba, loadSources, safeDocName } from './publish';
import { createWidget, newDashboard, newPage } from './model';
import { gridOf } from './grid';

const bounds = gridOf('portrait');
const src = (key: string, kind: Source['kind'], load: () => Promise<unknown>): Source => ({ key, kind, load });

describe('lumaFromRgba', () => {
  it('maps white to 255, black to 0 and weights green most', () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
    const out = new Uint8Array(7);
    lumaFromRgba(rgba, out, 1);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(255);
    expect(out[2]).toBe(0);
    expect(out[3]).toBe(77 * 255 >> 8);
    expect(out[4]).toBe(150 * 255 >> 8);
    expect(out[5]).toBe(29 * 255 >> 8);
    expect(out[6]).toBe(0);
  });
});

describe('safeDocName and buildMeta', () => {
  it('replaces characters that are not allowed in file names', () => {
    expect(safeDocName('Plan: A/B?')).toBe('Plan- A-B-');
    expect(safeDocName('  ..hidden  ')).toBe('hidden');
    expect(safeDocName('   ')).toBe('Dashboard');
  });

  it('takes folder and display from the dashboard, else from the app settings', () => {
    const d = newDashboard('Status');
    const pages = [{ width: 1650, height: 2200, links: [] }];
    expect(buildMeta(d, pages, { displayAfterPush: true })).toEqual({ name: 'Status', folder: '', display: true, pages });
    d.publish = { folder: ' Document/Wall ', display: false };
    expect(buildMeta(d, pages, { displayAfterPush: true })).toMatchObject({ folder: 'Document/Wall', display: false });
  });
});

describe('collectSources', () => {
  it('lists each distinct source once, across pages', () => {
    const d = newDashboard('T', [newPage('A'), newPage('B')]);
    d.pages[0].widgets.push(createWidget('system', bounds), createWidget('reader', bounds), createWidget('text', bounds));
    d.pages[1].widgets.push(createWidget('system', bounds), createWidget('web', bounds, {}, { url: 'https://example.com/a' }), createWidget('web', bounds, {}, { url: '' }));
    expect(collectSources(d).map((s) => s.key).sort()).toEqual(['reader', 'system', 'web:https://example.com/a']);
  });

  it('asks for a command only when it is set', () => {
    const d = newDashboard('T');
    d.pages[0].widgets.push(createWidget('command', bounds, {}, { command: ' uptime ' }), createWidget('command', bounds));
    expect(collectSources(d).map((s) => s.key)).toEqual(['cmd:uptime']);
  });
});

describe('loadSources', () => {
  it('loads in parallel and turns failures into per-source errors', async () => {
    const results = await loadSources(
      [src('a', 'system', async () => 1), src('b', 'web', async () => { throw new Error('boom'); }), src('c', 'reader', () => Promise.reject('offline'))],
      { allowCommands: false },
    );
    expect(results.a).toEqual({ ok: true, value: 1 });
    expect(results.b).toEqual({ ok: false, error: 'boom' });
    expect(results.c).toEqual({ ok: false, error: 'offline' });
  });

  it('times out a slow source without waiting for it', async () => {
    const results = await loadSources([src('slow', 'web', () => new Promise(() => {}))], { allowCommands: false, timeouts: { web: 20 } });
    expect(results.slow).toMatchObject({ ok: false });
    expect((results.slow as { error: string }).error).toMatch(/Timed out/);
  });

  it('does not run commands unless they are allowed, and says so', async () => {
    const load = vi.fn(async () => 'out');
    const off = await loadSources([src('cmd:x', 'command', load)], { allowCommands: false });
    expect(load).not.toHaveBeenCalled();
    expect(off['cmd:x']).toEqual({ ok: false, error: 'Commands are disabled in Settings', code: 'disabled' });
    const on = await loadSources([src('cmd:x', 'command', load)], { allowCommands: true });
    expect(on['cmd:x']).toEqual({ ok: true, value: 'out' });
  });
});
