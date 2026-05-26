import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decryptApiKey, encryptApiKey, generateKekBase64, getActiveKeyId } from './keyVault';

const KEK_V1 = generateKekBase64();
const KEK_V2 = generateKekBase64();

const originalEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  originalEnv.KEY_ENCRYPTION_KEY = process.env.KEY_ENCRYPTION_KEY;
  originalEnv.KEY_ENCRYPTION_KEY_v2 = process.env.KEY_ENCRYPTION_KEY_v2;
  process.env.KEY_ENCRYPTION_KEY = KEK_V1;
  process.env.KEY_ENCRYPTION_KEY_v2 = KEK_V2;
});

afterAll(() => {
  for (const [k, v] of Object.entries(originalEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('keyVault', () => {
  it('roundtrips a typical API key', () => {
    const plaintext = 'sk-test-1234567890abcdefABCDEF';
    const enc = encryptApiKey(plaintext);
    expect(enc.keyId).toBe(getActiveKeyId());
    expect(enc.last4).toBe('CDEF');
    expect(Buffer.isBuffer(enc.ciphertext)).toBe(true);
    expect(enc.ciphertext.toString('utf8')).not.toContain(plaintext);
    const round = decryptApiKey(enc.ciphertext, enc.keyId);
    expect(round).toBe(plaintext);
  });

  it('produces a different ciphertext each call (random IV)', () => {
    const plaintext = 'sk-same-input-every-time';
    const a = encryptApiKey(plaintext);
    const b = encryptApiKey(plaintext);
    expect(Buffer.compare(a.ciphertext, b.ciphertext)).not.toBe(0);
    expect(decryptApiKey(a.ciphertext, a.keyId)).toBe(plaintext);
    expect(decryptApiKey(b.ciphertext, b.keyId)).toBe(plaintext);
  });

  it('rejects tampered ciphertext (GCM auth tag check)', () => {
    const enc = encryptApiKey('sk-do-not-tamper-with-me');
    const tampered = Buffer.from(enc.ciphertext);
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => decryptApiKey(tampered, enc.keyId)).toThrow();
  });

  it('rejects decryption with the wrong KEK', () => {
    const enc = encryptApiKey('sk-encrypted-with-v1');
    expect(() => decryptApiKey(enc.ciphertext, 'v2')).toThrow();
  });

  it('decrypts with an older KEK after rotation', () => {
    const encV1 = encryptApiKey('sk-encrypted-with-v1');
    expect(encV1.keyId).toBe('v1');
    process.env.ACTIVE_KEY_ENCRYPTION_KEY_ID = 'v2';
    try {
      expect(decryptApiKey(encV1.ciphertext, 'v1')).toBe('sk-encrypted-with-v1');
      const encV2 = encryptApiKey('sk-encrypted-with-v2');
      expect(encV2.keyId).toBe('v2');
      expect(decryptApiKey(encV2.ciphertext, 'v2')).toBe('sk-encrypted-with-v2');
      expect(decryptApiKey(encV1.ciphertext, 'v1')).toBe('sk-encrypted-with-v1');
    } finally {
      delete process.env.ACTIVE_KEY_ENCRYPTION_KEY_ID;
    }
  });

  it('rejects empty plaintext', () => {
    expect(() => encryptApiKey('')).toThrow();
  });

  it('rejects ciphertext that is too short', () => {
    expect(() => decryptApiKey(Buffer.from([1, 2, 3]), 'v1')).toThrow();
  });

  it('rejects a missing KEK env var', () => {
    expect(() => decryptApiKey(Buffer.alloc(64), 'v99')).toThrow(/KEY_ENCRYPTION_KEY_v99/);
  });

  it('rejects a wrong-length KEK', () => {
    process.env.KEY_ENCRYPTION_KEY = Buffer.from('too-short').toString('base64');
    try {
      expect(() => encryptApiKey('whatever')).toThrow(/32 bytes/);
    } finally {
      process.env.KEY_ENCRYPTION_KEY = KEK_V1;
    }
  });
});
