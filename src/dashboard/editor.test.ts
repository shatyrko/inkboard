import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAVE_DELAY_MS, useEditor } from './editor';
import { newDashboard, newPage, type Dashboard } from './model';

function setup(initial: Dashboard = newDashboard('Test', [newPage('One'), newPage('Two')])) {
  const save = vi.fn(async (_d: Dashboard) => {});
  const ed = useEditor(save);
  ed.open(initial);
  return { ed, save, initial };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('opening', () => {
  it('starts on the first page, nothing selected, nothing to undo or save', () => {
    const { ed, initial } = setup();
    expect(ed.doc.value).toBe(initial);
    expect(ed.page.value?.name).toBe('One');
    expect(ed.selected.value).toBeNull();
    expect(ed.canUndo.value).toBe(false);
    expect(ed.saveState.value).toBe('saved');
  });
});

describe('widgets', () => {
  it('adds a widget on the current page and selects it', () => {
    const { ed } = setup();
    const w = ed.addWidget('text')!;
    expect(ed.page.value?.widgets.map((x) => x.id)).toEqual([w.id]);
    expect(ed.selectedId.value).toBe(w.id);
    expect(ed.canUndo.value).toBe(true);
  });

  it('places a new widget where asked', () => {
    const { ed } = setup();
    const w = ed.addWidget('box', { x: 5, y: 7 })!;
    expect(w).toMatchObject({ x: 5, y: 7 });
  });

  it('undoes and redoes, dropping the selection of a widget that no longer exists', () => {
    const { ed } = setup();
    ed.addWidget('text');
    ed.undo();
    expect(ed.page.value?.widgets).toEqual([]);
    expect(ed.selectedId.value).toBeNull();
    expect(ed.canRedo.value).toBe(true);
    ed.redo();
    expect(ed.page.value?.widgets).toHaveLength(1);
  });

  it('nudges within the page and folds repeated nudges into one undo step', () => {
    const { ed } = setup();
    const w = ed.addWidget('box', { x: 0, y: 0 })!;
    ed.nudge(1, 0);
    ed.nudge(1, 0);
    ed.nudge(-5, 0);
    expect(ed.selected.value?.x).toBe(0);
    ed.nudge(3, 2);
    expect(ed.selected.value).toMatchObject({ x: 3, y: 2 });
    ed.undo();
    expect(ed.selected.value?.id).toBe(w.id);
    expect(ed.selected.value).toMatchObject({ x: 0, y: 0 });
  });

  it('resizes by cells and never below the widget minimum', () => {
    const { ed } = setup();
    ed.addWidget('box', { x: 1, y: 1 });
    ed.resizeBy(2, 1);
    expect(ed.selected.value).toMatchObject({ w: 14, h: 7 });
    ed.resizeBy(-99, -99);
    expect(ed.selected.value).toMatchObject({ w: 1, h: 1 });
  });

  it('records a drag as one undo step', () => {
    const { ed } = setup();
    const w = ed.addWidget('box', { x: 2, y: 2 })!;
    ed.liveRect(w.id, { x: 3, y: 2, w: w.w, h: w.h });
    ed.liveRect(w.id, { x: 6, y: 4, w: w.w, h: w.h });
    expect(ed.selected.value).toMatchObject({ x: 6, y: 4 });
    ed.endGesture();
    ed.undo();
    expect(ed.selected.value).toMatchObject({ x: 2, y: 2 });
    expect(ed.page.value?.widgets).toHaveLength(1);
  });

  it('puts a cancelled drag back', () => {
    const { ed } = setup();
    const w = ed.addWidget('box', { x: 2, y: 2 })!;
    ed.liveRect(w.id, { x: 9, y: 9, w: w.w, h: w.h });
    ed.cancelGesture();
    expect(ed.selected.value).toMatchObject({ x: 2, y: 2 });
  });

  it('duplicates, copies, cuts and pastes', () => {
    const { ed } = setup();
    const a = ed.addWidget('box', { x: 2, y: 2 })!;
    ed.duplicate();
    expect(ed.page.value?.widgets).toHaveLength(2);
    expect(ed.selectedId.value).not.toBe(a.id);

    ed.cut();
    expect(ed.page.value?.widgets).toHaveLength(1);
    ed.selectPage(ed.doc.value!.pages[1].id);
    ed.paste();
    expect(ed.page.value?.name).toBe('Two');
    expect(ed.page.value?.widgets).toHaveLength(1);
    ed.paste({ x: 10, y: 10 });
    expect(ed.selected.value).toMatchObject({ x: 10, y: 10 });
  });

  it('reorders the selected widget', () => {
    const { ed } = setup();
    const a = ed.addWidget('box')!;
    ed.addWidget('box');
    ed.select(a.id);
    ed.reorder('front');
    const z = (id: string) => ed.page.value!.widgets.find((w) => w.id === id)!.z!;
    expect(z(a.id)).toBe(1);
  });

  it('merges quick edits of one property into one step', () => {
    const { ed } = setup();
    const w = ed.addWidget('text')!;
    for (const t of ['h', 'he', 'hel']) ed.patchProps(w.id, { text: t }, 'text');
    expect((ed.selected.value?.props as { text: string }).text).toBe('hel');
    ed.undo();
    expect(ed.page.value?.widgets).toHaveLength(1);
    expect((ed.selected.value?.props as { text: string }).text).toContain('Notes');
  });
});

describe('pages and dashboard', () => {
  it('adds a page and switches to it; undo falls back to an existing page', () => {
    const { ed } = setup();
    const id = ed.addPage()!;
    expect(ed.page.value?.id).toBe(id);
    expect(ed.pageIndex.value).toBe(2);
    ed.undo();
    expect(ed.doc.value?.pages).toHaveLength(2);
    expect(ed.page.value?.name).toBe('One');
  });

  it('renames, moves, duplicates and removes pages but keeps the last one', () => {
    const { ed } = setup();
    const [a, b] = ed.doc.value!.pages;
    ed.renamePage(a.id, 'First');
    ed.movePage(a.id, 1);
    expect(ed.doc.value?.pages.map((p) => p.name)).toEqual(['Two', 'First']);
    ed.duplicatePage(b.id);
    expect(ed.page.value?.name).toBe('Two copy');
    ed.removePage(a.id);
    ed.removePage(ed.doc.value!.pages[0].id);
    expect(ed.doc.value?.pages).toHaveLength(1);
    ed.removePage(ed.doc.value!.pages[0].id);
    expect(ed.doc.value?.pages).toHaveLength(1);
  });

  it('changes orientation, schedule and publish options', () => {
    const { ed } = setup();
    ed.setOrientation('landscape');
    ed.setSchedule({ enabled: true, everyMinutes: 15 });
    ed.setPublish({ folder: 'Document/Wall' });
    ed.rename('Wall');
    expect(ed.doc.value).toMatchObject({ orientation: 'landscape', name: 'Wall', schedule: { enabled: true, everyMinutes: 15 }, publish: { folder: 'Document/Wall' } });
  });
});

describe('autosave', () => {
  it('saves once, a moment after the last edit', async () => {
    const { ed, save } = setup();
    ed.addWidget('text');
    expect(ed.saveState.value).toBe('dirty');
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS - 10);
    expect(save).not.toHaveBeenCalled();
    ed.addWidget('box');
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS - 10);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toBe(ed.doc.value);
    expect(ed.saveState.value).toBe('saved');
  });

  it('flush saves at once and does nothing when there is nothing new', async () => {
    const { ed, save } = setup();
    ed.addWidget('text');
    await ed.flush();
    expect(save).toHaveBeenCalledTimes(1);
    await ed.flush();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('is clean again after undoing back to the saved state', async () => {
    const { ed } = setup();
    ed.addWidget('text');
    ed.undo();
    await ed.flush();
    expect(ed.saveState.value).toBe('saved');
  });

  it('reports a failed save and retries on the next flush', async () => {
    const { ed, save } = setup();
    save.mockRejectedValueOnce('disk full');
    ed.addWidget('text');
    await ed.flush();
    expect(ed.saveState.value).toBe('error');
    expect(ed.saveError.value).toBe('disk full');
    await ed.flush();
    expect(ed.saveState.value).toBe('saved');
  });

  it('never overlaps two saves: an edit made during one is written after it', async () => {
    const { ed, save } = setup();
    let release = () => {};
    save.mockImplementationOnce(() => new Promise<void>((r) => { release = r; }));
    ed.addWidget('text');
    const first = ed.flush();
    await vi.advanceTimersByTimeAsync(0);
    ed.addWidget('box');
    const second = ed.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
    expect(save.mock.calls.map((c) => c[0].pages[0].widgets.length)).toEqual([1, 2]);
    expect(ed.saveState.value).toBe('saved');
  });
});
