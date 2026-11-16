// Where the user is inside a USB reader: a stack of folders from the storage root. Folders are addressed by their handle,
// so the stack is all the state there is; "up" and "go to" just cut it.

export type Crumb = {
  /** null = the storage root */
  handle: number | null;
  name: string;
};

export const startStack = (storageName: string): Crumb[] => [{ handle: null, name: storageName }];

export const currentHandle = (stack: readonly Crumb[]): number | null => stack[stack.length - 1].handle;

export const enterFolder = (stack: readonly Crumb[], folder: { handle: number; name: string }): Crumb[] => [...stack, { handle: folder.handle, name: folder.name }];

/** one level up; the root stays the root */
export const goUp = (stack: readonly Crumb[]): Crumb[] => (stack.length > 1 ? stack.slice(0, -1) : [...stack]);

/** back to the crumb at `index` (a click in the breadcrumb) */
export const goTo = (stack: readonly Crumb[], index: number): Crumb[] => stack.slice(0, Math.max(1, index + 1));

/** "Books/Fiction", empty at the root */
export const folderPath = (stack: readonly Crumb[]): string => stack.slice(1).map((c) => c.name).join('/');
