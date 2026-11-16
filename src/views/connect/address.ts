// Input helpers of the connect flow.

/** "https://reader.local:8443/path" -> "reader.local": people paste whatever they copied */
export function normaliseAddress(input: string): string {
  return input
    .trim()
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '');
}

export function digitsOnly(input: string, max = 12): string {
  return input.replace(/\D/g, '').slice(0, max);
}
