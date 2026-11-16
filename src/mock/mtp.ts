// Mock of a USB reader (MTP) for browser-only development. Owned by the device/library views; the dashboard builder calls addMockFile.
export const handlers: Record<string, (a: any) => unknown> = {};

/** Puts a file into the mock USB reader's folder (creating folders), as publishing a dashboard to it would. */
export function addMockFile(_readerId: string, _folderPath: string, _name: string, _bytes: number): void {
  // implemented by the owner of this file
}
