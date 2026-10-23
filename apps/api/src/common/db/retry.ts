/**
 * Retry helper for transient PostgreSQL concurrency errors.
 *
 * Row-level locks (SELECT ... FOR UPDATE) serialise writers, but Postgres can
 * still abort a transaction with:
 *   - 40001 serialization_failure
 *   - 40P01 deadlock_detected
 * Prisma surfaces these as P2034 ("Transaction failed due to a write conflict or
 * a deadlock"). Such a transaction made no changes, so it is always safe to retry.
 */
export function isRetryableTxError(err: unknown): boolean {
  const e = err as { code?: string; message?: string; meta?: { code?: string } };
  if (!e) return false;
  if (e.code === 'P2034') return true;
  const pgCode = e.meta?.code ?? '';
  if (pgCode === '40001' || pgCode === '40P01') return true;
  const msg = e.message ?? '';
  return /could not serialize access|deadlock detected|40001|40P01/.test(msg);
}

export async function withTxRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryableTxError(err) || i === attempts - 1) throw err;
      const backoff = 20 * 2 ** i + Math.floor(Math.random() * 25);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}
