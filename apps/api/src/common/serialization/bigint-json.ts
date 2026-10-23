/**
 * JSON serialisation for BigInt.
 *
 * All money is stored as BIGINT paise. Express/Nest serialise responses with
 * JSON.stringify, which throws "Do not know how to serialize a BigInt" for any
 * Prisma row containing a BigInt column. Paise amounts are far below 2^53, so
 * they are emitted as JSON numbers; anything outside the safe-integer range is
 * emitted as a string rather than silently losing precision.
 */
declare global {
  interface BigInt {
    toJSON(): number | string;
  }
}

export function installBigIntJson(): void {
  if ((BigInt.prototype as any).__raftnowJson) return;
  Object.defineProperty(BigInt.prototype, 'toJSON', {
    value: function toJSON(this: bigint) {
      const asNumber = Number(this);
      return Number.isSafeInteger(asNumber) ? asNumber : this.toString();
    },
    writable: true,
    configurable: true,
  });
  Object.defineProperty(BigInt.prototype, '__raftnowJson', { value: true });
}

installBigIntJson();
