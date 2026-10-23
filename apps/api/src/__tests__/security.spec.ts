import { encryptField, decryptField, isEncryptedField, safeEqual, hmacSha256Hex } from '../common/crypto/field-encryption';
import { checkEnvironment } from '../common/config/env.validation';
import { WebhooksService } from '../webhooks/webhooks.service';
import { signAdminToken, verifyAdminToken } from '../admin/auth/admin-tokens';
import { roleHas, ROLE_PERMISSIONS } from '../admin/permissions';

const KEY = 'a'.repeat(64);

describe('field encryption (PAN / bank / TOTP secrets)', () => {
  beforeAll(() => (process.env.FIELD_ENCRYPTION_KEY = KEY));

  it('round-trips and never stores plaintext', () => {
    const enc = encryptField('ABCDE1234F');
    expect(enc).not.toContain('ABCDE1234F');
    expect(isEncryptedField(enc)).toBe(true);
    expect(decryptField(enc)).toBe('ABCDE1234F');
    expect(encryptField('ABCDE1234F')).not.toBe(enc); // random IV
  });

  it('detects tampering (GCM auth tag)', () => {
    const enc = encryptField('123456789012');
    const parts = enc.split(':');
    const ct = Buffer.from(parts[3], 'base64');
    ct[0] ^= 0xff;
    parts[3] = ct.toString('base64');
    expect(() => decryptField(parts.join(':'))).toThrow();
  });

  it('fails with the wrong key', () => {
    const enc = encryptField('secret');
    process.env.FIELD_ENCRYPTION_KEY = 'b'.repeat(64);
    expect(() => decryptField(enc)).toThrow();
    process.env.FIELD_ENCRYPTION_KEY = KEY;
  });
});

describe('environment validation', () => {
  const strong = 'x'.repeat(40);
  const prod = {
    APP_ENV: 'production', DATABASE_URL: 'postgres://x', QR_SIGNING_SECRET: strong, JWT_SECRET: strong, FIELD_ENCRYPTION_KEY: KEY,
    RAZORPAY_KEY_ID: 'rzp_live_abc123', RAZORPAY_KEY_SECRET: strong, RAZORPAY_WEBHOOK_SECRET: strong,
    FIREBASE_PROJECT_ID: 'p', FIREBASE_CLIENT_EMAIL: 'e', FIREBASE_PRIVATE_KEY: 'k', STORAGE_DRIVER: 's3', S3_BUCKET_PRIVATE: 'b', S3_REGION: 'r',
    CORS_ALLOWED_ORIGINS: 'https://raftnow.in',
  };

  it('accepts a complete production config', () => {
    expect(checkEnvironment(prod as any).errors).toEqual([]);
  });
  it('refuses dev auth bypass in production', () => {
    expect(checkEnvironment({ ...prod, AUTH_DEV_BYPASS: 'true' } as any).errors.join()).toMatch(/AUTH_DEV_BYPASS/);
  });
  it('refuses placeholder secrets in production', () => {
    const r = checkEnvironment({ ...prod, QR_SIGNING_SECRET: 'change-me-to-a-secure-32-byte-random-secret' } as any);
    expect(r.errors.join()).toMatch(/QR_SIGNING_SECRET/);
  });
  it('only warns in development', () => {
    const r = checkEnvironment({ APP_ENV: 'development', DATABASE_URL: 'postgres://x' } as any);
    expect(r.errors).toEqual([]);
    expect(r.warnings.length).toBeGreaterThan(3);
  });
});

describe('Razorpay webhook signature', () => {
  const svc = new WebhooksService(null as any, null as any, null as any, null as any, null as any);
  const body = Buffer.from('{"event":"payment.captured"}');
  beforeAll(() => (process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_test_123'));

  it('accepts the correct HMAC and rejects others without throwing', () => {
    expect(svc.verifyWebhookSignature(body, hmacSha256Hex('whsec_test_123', body))).toBe(true);
    expect(svc.verifyWebhookSignature(body, hmacSha256Hex('wrong', body))).toBe(false);
    expect(svc.verifyWebhookSignature(body, 'short')).toBe(false); // length mismatch used to throw → 500
  });

  it('takes the event id from X-Razorpay-Event-Id (the body has no top-level id)', () => {
    expect(WebhooksService.eventIdFor('evt_ABC123xyz', {}, body)).toBe('evt_ABC123xyz');
    expect(WebhooksService.eventIdFor(undefined, {}, body)).toMatch(/^sha256:/);
  });

  it('safeEqual is length-safe', () => {
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('abc', 'abc')).toBe(true);
  });
});

describe('admin tokens and RBAC', () => {
  beforeAll(() => (process.env.JWT_SECRET = 'j'.repeat(48)));

  it('a token of one type can never be used as another', () => {
    const mfa = signAdminToken({ sub: 'a1', typ: 'admin_mfa', tv: 0, role: 'OPS' }).token;
    expect(() => verifyAdminToken(mfa, 'admin_access')).toThrow();
    const enroll = signAdminToken({ sub: 'a1', typ: 'admin_enroll', tv: 0, role: 'OPS' }).token;
    expect(() => verifyAdminToken(enroll, 'admin_access')).toThrow();
    expect(verifyAdminToken(signAdminToken({ sub: 'a1', typ: 'admin_access', tv: 3, role: 'OPS' }).token, 'admin_access').tv).toBe(3);
  });

  it('role matrix', () => {
    expect(roleHas('OPS', 'closures:write')).toBe(true);
    expect(roleHas('FINANCE', 'closures:write')).toBe(false);
    expect(roleHas('OPS', 'finance:write')).toBe(false);
    expect(roleHas('FINANCE', 'vendors:route')).toBe(true);
    expect(roleHas('OPS', 'admins:manage')).toBe(false);
    expect(ROLE_PERMISSIONS.SUPER_ADMIN.length).toBeGreaterThan(ROLE_PERMISSIONS.OPS.length);
  });
});
