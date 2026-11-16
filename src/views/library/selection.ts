// Multi-selection in the file table, as plain functions over the visible row order.

export type Selection = {
  ids: ReadonlySet<string>;
  /** where a shift-range starts */
  anchor: string | null;
  /** the row the keyboard moves from */
  focus: string | null;
};

export const emptySelection = (): Selection => ({ ids: new Set(), anchor: null, focus: null });

const range = (order: readonly string[], a: number, b: number): string[] => order.slice(Math.min(a, b), Math.max(a, b) + 1);

/** click, Ctrl+click (toggle) and Shift+click (range from the anchor) */
export function clickSelect(sel: Selection, order: readonly string[], id: string, mods: { ctrl: boolean; shift: boolean }): Selection {
  const at = order.indexOf(id);
  if (at < 0) return sel;
  if (mods.shift) {
    const from = order.indexOf(sel.anchor ?? sel.focus ?? id);
    const span = range(order, from < 0 ? at : from, at);
    const ids = new Set(mods.ctrl ? [...sel.ids, ...span] : span);
    return { ids, anchor: order[from < 0 ? at : from], focus: id };
  }
  if (mods.ctrl) {
    const ids = new Set(sel.ids);
    if (!ids.delete(id)) ids.add(id);
    return { ids, anchor: id, focus: id };
  }
  return { ids: new Set([id]), anchor: id, focus: id };
}

/** arrows, Home/End (pass ±Infinity) and page keys; `extend` is Shift */
export function moveSelect(sel: Selection, order: readonly string[], delta: number, extend: boolean): Selection {
  if (!order.length) return sel;
  const cur = sel.focus ? order.indexOf(sel.focus) : -1;
  const from = cur < 0 ? (delta > 0 ? -1 : order.length) : cur;
  const to = Math.max(0, Math.min(order.length - 1, from + delta));
  const id = order[to];
  if (!extend) return { ids: new Set([id]), anchor: id, focus: id };
  const anchor = sel.anchor && order.includes(sel.anchor) ? sel.anchor : (order[cur < 0 ? to : cur]);
  return { ids: new Set(range(order, order.indexOf(anchor), to)), anchor, focus: id };
}

export const selectAll = (order: readonly string[]): Selection => ({
  ids: new Set(order),
  anchor: order[0] ?? null,
  focus: order[order.length - 1] ?? null,
});

/** drops ids that are no longer in the list (after a reload, a search or a folder change) */
export function prune(sel: Selection, order: readonly string[]): Selection {
  const present = new Set(order);
  const ids = [...sel.ids].filter((i) => present.has(i));
  if (ids.length === sel.ids.size && (sel.focus === null || present.has(sel.focus))) return sel;
  return {
    ids: new Set(ids),
    anchor: sel.anchor && present.has(sel.anchor) ? sel.anchor : null,
    focus: sel.focus && present.has(sel.focus) ? sel.focus : null,
  };
}
