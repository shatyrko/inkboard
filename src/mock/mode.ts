// The ?mock=... URL switch, read once. What each value does is listed at the top of device.ts and mtp.ts.
export const mode = new URLSearchParams(location.search).get('mock') ?? '';
