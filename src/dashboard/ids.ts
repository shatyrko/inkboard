/** short random ids for pages, widgets and checklist items (unique within one document, not globally) */
export const newId = (): string => Math.random().toString(36).slice(2, 10);
