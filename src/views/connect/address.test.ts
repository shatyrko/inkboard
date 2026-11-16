import { describe, expect, it } from 'vitest';
import { digitsOnly, normaliseAddress } from './address';

describe('normaliseAddress', () => {
  it('leaves a bare address alone', () => {
    expect(normaliseAddress('192.0.2.41')).toBe('192.0.2.41');
    expect(normaliseAddress('  reader.local  ')).toBe('reader.local');
  });
  it('strips scheme, port and path', () => {
    expect(normaliseAddress('https://192.0.2.41:8443/api/x')).toBe('192.0.2.41');
    expect(normaliseAddress('reader.local:8443')).toBe('reader.local');
  });
});

describe('digitsOnly', () => {
  it('keeps digits and caps the length', () => {
    expect(digitsOnly('12 34-56ab78')).toBe('12345678');
    expect(digitsOnly('1234567890123456', 10)).toBe('1234567890');
  });
});
