import { createCipheriv, createDecipheriv, randomBytes, createHmac, timingSafeEqual } from 'crypto';

/**
 * Application-level field encryption for sensitive KYC data (PAN, bank account
 * numbers, TOTP secrets).
 *
 * AES-256-GCM (authenticated encryption — tampering is detected on decrypt).
 * Stored format: "v1:<iv b64>:<auth tag b64>:<ciphertext b64>".
 *
 * Key: FIELD_ENCRYPTION_KEY — 32 bytes, hex (64 chars) or base64.
 * The plaintext is never logged by this module.
 */
const VERSION = 'v1';

function loadKey(): Buffer {
  const raw = process.env.FIELD_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('FIELD_ENCRYPTION_KEY is not configured');
  }
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('FIELD_ENCRYPTION_KEY must decode to exactly 32 bytes');
  }
  return key;
}

export function encryptField(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

export function decryptField(stored: string): string {
  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Unrecognised encrypted field format');
  }
  const key = loadKey();
  const [, ivB64, tagB64, ctB64] = parts;
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}

export function isEncryptedField(value: string | null | undefined): boolean {
  return !!value && value.startsWith(`${VERSION}:`) && value.split(':').length === 4;
}

/** Masks all but the last 4 characters, e.g. "XXXXXX1234". */
export function last4(value: string): string {
  return value.slice(-4);
}

/** Constant-time comparison of two strings (lengths may differ). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function hmacSha256Hex(secret: string, data: string | Buffer): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}
