import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALG = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

export function getActiveKeyId(): string {
  return process.env.ACTIVE_KEY_ENCRYPTION_KEY_ID ?? 'v1';
}

function loadKek(keyId: string): Buffer {
  const suffixed = process.env[`KEY_ENCRYPTION_KEY_${keyId}`];
  const bare = keyId === 'v1' ? process.env.KEY_ENCRYPTION_KEY : undefined;
  const raw = suffixed ?? bare;
  if (!raw) {
    const envName = `KEY_ENCRYPTION_KEY_${keyId}`;
    throw new Error(`Missing env var ${envName} for key id "${keyId}"`);
  }
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== KEY_LEN) {
    throw new Error(`KEK for "${keyId}" must decode to ${KEY_LEN} bytes (got ${buf.length}); generate with: openssl rand -base64 32`);
  }
  return buf;
}

export interface EncryptedSecret {
  ciphertext: Buffer;
  keyId: string;
  last4: string;
}

export function encryptApiKey(plaintext: string): EncryptedSecret {
  if (!plaintext) throw new Error('Plaintext must be a non-empty string');
  const keyId = getActiveKeyId();
  const kek = loadKek(keyId);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALG, kek, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([iv, tag, encrypted]),
    keyId,
    last4: plaintext.slice(-4),
  };
}

export function decryptApiKey(ciphertext: Buffer, keyId: string): string {
  if (ciphertext.length < IV_LEN + TAG_LEN + 1) {
    throw new Error('Ciphertext is too short to contain IV + tag + data');
  }
  const kek = loadKek(keyId);
  const iv = ciphertext.subarray(0, IV_LEN);
  const tag = ciphertext.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const data = ciphertext.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALG, kek, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export function generateKekBase64(): string {
  return randomBytes(KEY_LEN).toString('base64');
}
