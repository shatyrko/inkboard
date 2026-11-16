// What a widget type is made of. A definition is plain data plus a draw function, so the renderer, the editor's forms
// and the publisher all work from the same registry (./index.ts) and adding a widget means adding one file.
import type { LinkRect } from '../../lib/types';
import type { Result, Source } from '../data';
import type { Ctx2D } from '../draw';
import type { Rect } from '../grid';
import type { Page, WidgetProps, WidgetType } from '../model';
import type { Measure } from '../text';

/** what a widget may know about the page it sits on */
export type RenderEnv = { now: Date; pages: Page[]; pageIndex: number };

/** Drawing happens in the widget's own box: (0, 0) is its top-left corner and it is clipped to w x h. */
export type DrawContext<P, D> = {
  g: Ctx2D;
  w: number;
  h: number;
  props: P;
  /** undefined while the data has not been loaded (editor preview only); published pages always have a result */
  data: Result<D> | undefined;
  env: RenderEnv;
  measure: Measure;
};

export type Option = { value: string; label: string };
type Base<P> = { key: keyof P & string; label: string; hint?: string; when?: (p: P) => boolean };

/** A property form field. The sidebar renders these generically; checklist, image and target have their own controls. */
export type Field<P> =
  | (Base<P> & { kind: 'text'; placeholder?: string; mono?: boolean })
  | (Base<P> & { kind: 'area'; rows?: number; placeholder?: string; mono?: boolean })
  | (Base<P> & { kind: 'number'; min: number; max: number; step?: number; unit?: string })
  | (Base<P> & { kind: 'select' | 'seg'; options: Option[] })
  | (Base<P> & { kind: 'switch' })
  | (Base<P> & { kind: 'date' })
  | (Base<P> & { kind: 'multi'; options: Option[] })
  | (Base<P> & { kind: 'checklist' })
  | (Base<P> & { kind: 'image' })
  | (Base<P> & { kind: 'target' });

export type WidgetDef<T extends WidgetType, D = unknown> = {
  type: T;
  label: string;
  /** a name from components/Icon.vue */
  icon: string;
  /** one line for the add-widget palette */
  blurb: string;
  /** default and minimum size in grid cells */
  size: { w: number; h: number; minW: number; minH: number };
  defaults: () => WidgetProps[T];
  /** range-clamps props after they were coerced to the right types (loading, pasting) */
  normalize?: (p: WidgetProps[T]) => WidgetProps[T];
  fields: Field<WidgetProps[T]>[];
  /** the data this widget needs, or null; widgets with the same source key share one load */
  source?: (p: WidgetProps[T]) => Source<D> | null;
  /** a source that must not run while the user is typing (it reaches the network or runs a command): the editor loads it on request only */
  manual?: { label: string };
  draw: (c: DrawContext<WidgetProps[T], D>) => void;
  /** clickable regions this widget adds to its page in the PDF, in page pixels */
  links?: (c: { rect: Rect; props: WidgetProps[T]; pages: Page[]; pageIndex: number }) => LinkRect[];
};

/** a definition of any type, for code that goes through the registry by a runtime type name */
export type AnyWidgetDef = WidgetDef<any, any>;
