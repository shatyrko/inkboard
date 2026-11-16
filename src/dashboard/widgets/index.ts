// The widget registry: one definition per type. Add a widget by writing its file and listing it here (and in WidgetProps, ../model.ts).
import type { WidgetType } from '../model';
import type { WidgetDef } from './types';
import { boxWidget } from './box';
import { calendarWidget } from './calendar';
import { checklistWidget } from './checklist';
import { clockWidget } from './clock';
import { commandWidget } from './command';
import { countdownWidget } from './countdown';
import { imageWidget } from './image';
import { linkWidget } from './link';
import { navWidget } from './nav';
import { readerWidget } from './reader';
import { specimenWidget } from './specimen';
import { systemWidget } from './system';
import { textWidget } from './text';
import { webWidget } from './web';

// the data type D differs per widget; consumers go through the helpers in render.ts and publish.ts instead of indexing by union
export const registry: { [K in WidgetType]: WidgetDef<K, any> } = {
  text: textWidget,
  clock: clockWidget,
  calendar: calendarWidget,
  checklist: checklistWidget,
  countdown: countdownWidget,
  image: imageWidget,
  system: systemWidget,
  reader: readerWidget,
  web: webWidget,
  command: commandWidget,
  box: boxWidget,
  link: linkWidget,
  nav: navWidget,
  specimen: specimenWidget,
};

export const isWidgetType = (v: unknown): v is WidgetType => typeof v === 'string' && Object.prototype.hasOwnProperty.call(registry, v);
