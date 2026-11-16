import { describe, expect, it } from 'vitest';
import type { PublishResult, PublishTarget, Reader } from '../lib/types';
import { newDashboard, type Dashboard } from './model';
import { buildMeta } from './publish';
import {
  DPT_TARGET, FORMAT_LABEL, defaultFolder, describePushed, formatHint, isTargetReachable, kindOfTarget, retarget, targetFor, targetName, targetOf, targetOptions, targetReaderId,
} from './publish-target';

const dpt = (connected = true): Reader => ({ id: 'dpt', kind: 'digital-paper', name: 'DPT-RP1', maker: 'Sony', connected, link: 'wifi' });
const boox = (connected = true, id = 'mtp:ab12'): Reader => ({ id, kind: 'mtp', name: 'Tab X C', maker: 'ONYX', connected, link: 'usb' });
const toBoox = (over: Partial<Extract<PublishTarget, { kind: 'mtp' }>> = {}): Dashboard => ({
  ...newDashboard('Wall'),
  publish: { target: { kind: 'mtp', readerId: 'mtp:ab12', folder: '', format: 'pdf', ...over }, targetName: 'Tab X C' },
});
const result = (over: Partial<PublishResult> = {}): PublishResult => ({ path: 'Documents/Inkboard/Wall.pdf', entryId: '', pages: 1, bytes: 120_000, ...over });

describe('target of a dashboard', () => {
  it('is the Digital Paper unless the dashboard says otherwise', () => {
    expect(targetOf(newDashboard('A'))).toEqual({ kind: 'dpt' });
    expect(targetOf(null)).toEqual({ kind: 'dpt' });
    expect(targetOf(toBoox())).toMatchObject({ kind: 'mtp', readerId: 'mtp:ab12' });
  });

  it('names the reader id and kind', () => {
    expect(targetReaderId(DPT_TARGET)).toBe('dpt');
    expect(targetReaderId(targetOf(toBoox()))).toBe('mtp:ab12');
    expect(kindOfTarget(DPT_TARGET)).toBe('digital-paper');
    expect(kindOfTarget(targetOf(toBoox()))).toBe('mtp');
  });

  it('shows the folder a reader uses when the field is empty', () => {
    expect(defaultFolder('pdf')).toBe('Documents/Inkboard');
    expect(defaultFolder('png')).toBe('Pictures/Inkboard');
    expect(defaultFolder('template')).toBe('noteTemplate');
  });

  it('labels and explains each format', () => {
    expect(FORMAT_LABEL).toEqual({ pdf: 'PDF', png: 'PNG per page', template: 'Pen template' });
    expect(formatHint('pdf')).toContain('Page links work');
    expect(formatHint('png')).toBe('One image per page. Page links do not work in images.');
    expect(formatHint('template')).toBe("A page to write on with the reader's pen. Page links do not work in templates.");
  });
});

describe('the target a new dashboard starts with', () => {
  it('is the active reader: a USB reader as PDF into its default folder, anything else the Digital Paper', () => {
    expect(targetFor(boox())).toEqual({ target: { kind: 'mtp', readerId: 'mtp:ab12', folder: '', format: 'pdf' }, targetName: 'Tab X C' });
    expect(targetFor(dpt())).toEqual({ target: { kind: 'dpt' } });
    expect(targetFor(null)).toEqual({ target: { kind: 'dpt' } });
  });
});

describe('isTargetReachable', () => {
  it('looks at the target reader, not at the Digital Paper', () => {
    const readers = [dpt(true), boox(false)];
    expect(isTargetReachable({ kind: 'dpt' }, readers, true)).toBe(true);
    expect(isTargetReachable(targetOf(toBoox()), readers, true)).toBe(false);
    expect(isTargetReachable(targetOf(toBoox()), [dpt(false), boox(true)], false)).toBe(true);
  });

  it('treats an unplugged USB reader (missing from the list) as unreachable', () => {
    expect(isTargetReachable(targetOf(toBoox()), [dpt(true)], true)).toBe(false);
    expect(isTargetReachable(targetOf(toBoox()), [], true)).toBe(false);
  });

  it('keeps the Digital Paper reachable while its Wi-Fi session is alive, even before the readers list is loaded', () => {
    expect(isTargetReachable({ kind: 'dpt' }, [], true)).toBe(true);
    expect(isTargetReachable({ kind: 'dpt' }, [], false)).toBe(false);
    expect(isTargetReachable({ kind: 'dpt' }, [dpt(false)], false)).toBe(false);
  });
});

describe('targetOptions', () => {
  it('lists the connected readers by their full names', () => {
    const o = targetOptions([dpt(true), boox(true), boox(false, 'mtp:gone')], { kind: 'dpt' }, { dptConnected: true });
    expect(o).toEqual([{ id: 'dpt', label: 'Sony DPT-RP1' }, { id: 'mtp:ab12', label: 'ONYX Tab X C' }]);
  });

  it('keeps the current target visible when its reader is listed but not connected', () => {
    const o = targetOptions([dpt(true), boox(false)], targetOf(toBoox()), { dptConnected: true });
    expect(o.map((x) => x.label)).toEqual(['Sony DPT-RP1', 'ONYX Tab X C (not connected)']);
  });

  it('keeps it visible, under the remembered name, when the reader is not listed at all', () => {
    expect(targetOptions([dpt(true)], targetOf(toBoox()), { rememberedName: 'Tab X C', dptConnected: true }).map((x) => x.label)).toEqual(['Sony DPT-RP1', 'Tab X C (not connected)']);
    expect(targetOptions([], targetOf(toBoox()), { dptConnected: true }).map((x) => x.label)).toEqual(['USB reader (not connected)']);
  });

  it('names the Digital Paper when the list has not loaded', () => {
    expect(targetOptions([], { kind: 'dpt' }, { dptConnected: true })).toEqual([{ id: 'dpt', label: 'Digital Paper' }]);
    expect(targetOptions([], { kind: 'dpt' }, { dptConnected: false })).toEqual([{ id: 'dpt', label: 'Digital Paper (not connected)' }]);
  });
});

describe('retarget', () => {
  const readers = [dpt(), boox(), boox(true, 'mtp:other')];

  it('switches to the Digital Paper or to another USB reader with that reader\'s defaults', () => {
    const current = targetOf(toBoox({ folder: 'Documents/Wall', format: 'png' }));
    expect(retarget('dpt', readers, current)).toEqual({ target: { kind: 'dpt' } });
    expect(retarget('mtp:other', readers, current)).toEqual({ target: { kind: 'mtp', readerId: 'mtp:other', folder: '', format: 'pdf' }, targetName: 'Tab X C' });
  });

  it('keeps the folder and format when the reader is already the target', () => {
    const current = targetOf(toBoox({ folder: 'Documents/Wall', format: 'png' }));
    expect(retarget('mtp:ab12', readers, current)).toEqual({ target: current, targetName: 'Tab X C' });
  });

  it('leaves the target alone for a reader it does not know', () => {
    expect(retarget('mtp:nope', readers, { kind: 'dpt' })).toEqual({ target: { kind: 'dpt' } });
  });
});

describe('names and messages', () => {
  it('names the target reader: the listed one, else the remembered one', () => {
    expect(targetName(toBoox(), [boox()])).toBe('Tab X C');
    expect(targetName(toBoox(), [])).toBe('Tab X C');
    expect(targetName({ ...toBoox(), publish: { target: targetOf(toBoox()) } }, [])).toBe('the USB reader');
    expect(targetName(newDashboard('A'), [dpt()])).toBe('Sony DPT-RP1');
  });

  it('keeps the Digital Paper toast as it was', () => {
    expect(describePushed(newDashboard('Wall'), result({ path: 'Document/Dashboards/Wall.pdf', pages: 2 }), [dpt()])).toBe('Published "Wall" to Document/Dashboards/Wall.pdf (2 pages, 120 KB)');
  });

  it('says where a file was saved on a USB reader, and never that it was opened', () => {
    expect(describePushed(toBoox(), result(), [boox()])).toBe('Saved to Documents/Inkboard/Wall.pdf on Tab X C');
    const png = toBoox({ format: 'png' });
    expect(describePushed(png, result({ path: 'Pictures/Inkboard/Wall.png' }), [boox()])).toBe('Saved to Pictures/Inkboard/Wall.png on Tab X C');
    expect(describePushed(png, result({ path: 'Pictures/Inkboard', pages: 3 }), [boox()])).toBe('Saved 3 images to Pictures/Inkboard on Tab X C');
    expect(describePushed(toBoox(), result(), [boox()])).not.toMatch(/open/i);
  });

  it('tells where a pen template went and where to pick it in Boox Notes', () => {
    const tpl = toBoox({ format: 'template' });
    expect(describePushed(tpl, result({ path: 'noteTemplate/Wall.png' }), [boox()])).toBe(
      'Saved as a pen template to noteTemplate on Tab X C. In Boox Notes, pick it under Template > Custom.',
    );
    expect(describePushed(tpl, result({ path: 'noteTemplate', pages: 3 }), [boox()])).toBe(
      'Saved 3 pen templates to noteTemplate on Tab X C. In Boox Notes, pick them under Template > Custom.',
    );
    const custom = toBoox({ format: 'template', folder: 'Notes/noteTemplate' });
    expect(describePushed(custom, result({ path: 'Notes/noteTemplate/Wall.png' }), [boox()])).toContain('to Notes/noteTemplate on Tab X C');
  });
});

describe('buildMeta with a pen template target', () => {
  it('sends the template format along like any USB target', () => {
    const d = toBoox({ format: 'template' });
    expect(buildMeta(d, [{ width: 1650, height: 2200, links: [] }], { displayAfterPush: true })).toMatchObject({ folder: '', display: false, target: { kind: 'mtp', format: 'template', folder: '' } });
  });
});

describe('buildMeta with a target', () => {
  const pages = [{ width: 1650, height: 2200, links: [] }];

  it('leaves the Digital Paper meta without a target, as before', () => {
    const meta = buildMeta(newDashboard('Wall'), pages, { displayAfterPush: true });
    expect(meta).toEqual({ name: 'Wall', folder: '', display: true, pages });
    expect('target' in meta).toBe(false);
  });

  it('sends a USB target along and never asks to open the file', () => {
    const d = toBoox({ folder: 'Documents/Wall', format: 'png' });
    d.publish = { ...d.publish, folder: 'Document/Old', display: true };
    expect(buildMeta(d, pages, { displayAfterPush: true })).toEqual({
      name: 'Wall', folder: '', display: false, pages, target: { kind: 'mtp', readerId: 'mtp:ab12', folder: 'Documents/Wall', format: 'png' },
    });
  });
});
