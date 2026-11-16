import { describe, expect, it } from 'vitest';
import { uniqueName } from './library';
import { fingerprint } from './widgets/image';

describe('uniqueName', () => {
  it('keeps a free name and numbers a taken one, ignoring case', () => {
    expect(uniqueName('Daily', [])).toBe('Daily');
    expect(uniqueName('Daily', ['Weekly'])).toBe('Daily');
    expect(uniqueName('Daily', ['Daily'])).toBe('Daily 2');
    expect(uniqueName('Daily', ['daily', 'Daily 2'])).toBe('Daily 3');
  });
});

describe('fingerprint', () => {
  it('tells different pictures apart and is stable for the same one', () => {
    const a = 'A' + 'z'.repeat(5000);
    expect(fingerprint(a)).toBe(fingerprint(a));
    expect(fingerprint(a)).not.toBe(fingerprint('B' + 'z'.repeat(5000)));
    expect(fingerprint(a)).not.toBe(fingerprint('A' + 'z'.repeat(5001)));
  });
});
