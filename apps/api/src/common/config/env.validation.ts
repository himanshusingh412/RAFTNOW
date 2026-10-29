/**
 * Boot-time environment validation.
 *
 * Production refuses to start with missing or placeholder secrets (fail fast —
 * a misconfigured payment/auth system must never serve traffic). Development
 * only warns, so the stack can run locally without third-party credentials;
 * the affected features then return explicit "not configured" errors.
 */
const PLACEHOLDER = /^(change-me|your[_-]|rzp_test_x+$)|dev-only|insecure/i;

export interface EnvReport {
  errors: string[];
  warnings: string[];
  isProduction: boolean;
}

function present(v: string | undefined): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function strongSecret(v: string | undefined, min = 32): boolean {
  return present(v) && v.length >= min && !PLACEHOLDER.test(v);
}

/** The docker-compose development default — never acceptable in production. */
export const DEV_FIELD_ENCRYPTION_KEY = 'ZGV2LW9ubHktZmllbGQtZW5jcnlwdGlvbi1rZXkhISE=';

function validEncryptionKey(v: string | undefined): boolean {
  if (!present(v) || PLACEHOLDER.test(v) || v === DEV_FIELD_ENCRYPTION_KEY) return false;
  const buf = /^[0-9a-fA-F]{64}$/.test(v) ? Buffer.from(v, 'hex') : Buffer.from(v, 'base64');
  return buf.length === 32;
}

export function checkEnvironment(env: NodeJS.ProcessEnv = process.env): EnvReport {
  const isProduction = env.APP_ENV === 'production';
  const errors: string[] = [];
  const warnings: string[] = [];
  const need = (ok: boolean, msg: string) => (ok ? undefined : (isProduction ? errors : warnings).push(msg));

  if (!present(env.DATABASE_URL)) errors.push('DATABASE_URL is required');

  need(strongSecret(env.QR_SIGNING_SECRET), 'QR_SIGNING_SECRET must be a random value of >= 32 chars (QR tickets disabled)');
  need(strongSecret(env.JWT_SECRET), 'JWT_SECRET must be a random value of >= 32 chars (admin login disabled)');
  need(validEncryptionKey(env.FIELD_ENCRYPTION_KEY), 'FIELD_ENCRYPTION_KEY must be 32 bytes (hex or base64) (vendor KYC / admin 2FA disabled)');
  need(present(env.RAZORPAY_KEY_ID) && present(env.RAZORPAY_KEY_SECRET) && !PLACEHOLDER.test(env.RAZORPAY_KEY_SECRET ?? ''),
    'RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not configured (payments, refunds, payouts disabled)');
  need(strongSecret(env.RAZORPAY_WEBHOOK_SECRET, 8), 'RAZORPAY_WEBHOOK_SECRET not configured (webhooks will be rejected)');
  need(present(env.FIREBASE_PROJECT_ID) && present(env.FIREBASE_CLIENT_EMAIL) && present(env.FIREBASE_PRIVATE_KEY)
    && !PLACEHOLDER.test(env.FIREBASE_PROJECT_ID ?? ''),
    'Firebase Admin credentials not configured (customer/vendor phone login disabled)');

  const driver = env.STORAGE_DRIVER ?? 'local';
  if (driver === 's3') {
    need(present(env.S3_BUCKET_PRIVATE) && present(env.S3_REGION), 'S3_BUCKET_PRIVATE / S3_REGION required for STORAGE_DRIVER=s3');
    need(present(env.S3_BUCKET_PUBLIC) && present(env.PUBLIC_MEDIA_BASE_URL),
      'S3_BUCKET_PUBLIC / PUBLIC_MEDIA_BASE_URL required for STORAGE_DRIVER=s3 (trip photo uploads disabled)');
  } else if (driver === 'local') {
    need(strongSecret(env.STORAGE_SIGNING_SECRET), 'STORAGE_SIGNING_SECRET must be >= 32 chars for local document storage');
    if (isProduction) warnings.push('STORAGE_DRIVER=local in production: KYC documents live on the API container disk — use s3');
  } else {
    errors.push(`STORAGE_DRIVER must be "s3" or "local" (got "${driver}")`);
  }

  if (env.AUTH_DEV_BYPASS === 'true') {
    if (isProduction) errors.push('AUTH_DEV_BYPASS=true is forbidden when APP_ENV=production');
    else warnings.push('AUTH_DEV_BYPASS=true — developer tokens ("dev:<uid>:<phone>") are accepted. Local development only.');
  }

  if (isProduction && !present(env.CORS_ALLOWED_ORIGINS)) {
    errors.push('CORS_ALLOWED_ORIGINS is required in production');
  }

  return { errors, warnings, isProduction };
}

export function assertEnvironment(logger: { warn(msg: string): void; error(msg: string): void }): void {
  const report = checkEnvironment();
  for (const w of report.warnings) logger.warn(`[config] ${w}`);
  if (report.errors.length > 0) {
    for (const e of report.errors) logger.error(`[config] ${e}`);
    throw new Error(`Invalid configuration: ${report.errors.length} error(s). Refusing to start.`);
  }
}
