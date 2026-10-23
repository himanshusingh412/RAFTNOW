// ─────────────────────────────────────────────────────────────────────────────
// Booking code generation and validation
//
// Booking code: 6 characters from a safe alphabet (no look-alike chars).
// Alphabet excludes: 0, O, 1, I, L (look-alike pairs).
// QR token: JWT-signed payload containing booking ID + code.
// ─────────────────────────────────────────────────────────────────────────────

/** Safe alphabet: excludes 0/O, 1/I/L look-alike characters */
export const BOOKING_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const BOOKING_CODE_LENGTH = 6;

/**
 * Generates a random booking code.
 * Format: RF-prefixed 6-char code from safe alphabet.
 * @example generateBookingCode() → "RF7K2M"
 *
 * NOTE: The "RF" prefix is stripped from the stored code.
 * The full display code is "RF" + code.
 */
export function generateBookingCode(): string {
  let code = '';
  const alphabetLength = BOOKING_CODE_ALPHABET.length;

  // Use crypto.getRandomValues if available (browser/Node 16+), else Math.random fallback
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(BOOKING_CODE_LENGTH);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < BOOKING_CODE_LENGTH; i++) {
      code += BOOKING_CODE_ALPHABET[bytes[i] % alphabetLength];
    }
  } else {
    for (let i = 0; i < BOOKING_CODE_LENGTH; i++) {
      code += BOOKING_CODE_ALPHABET[Math.floor(Math.random() * alphabetLength)];
    }
  }

  return code;
}

/**
 * Validates a booking code format.
 * Must be exactly 6 characters from the safe alphabet.
 */
export function isValidBookingCode(code: string): boolean {
  if (code.length !== BOOKING_CODE_LENGTH) return false;
  const validChars = new Set(BOOKING_CODE_ALPHABET.split(''));
  return code.split('').every((char) => validChars.has(char));
}

/**
 * Returns the display booking code with the "RF" prefix.
 * @example toDisplayCode("7K2M3P") → "RF7K2M3P"
 *
 * Wait — display is just the raw code from DB, prefix is for branding only.
 * Let's return just the code as-is; the UI can add "RF" if desired.
 */
export function toDisplayCode(code: string): string {
  return `RF${code}`;
}

/**
 * Strips the "RF" prefix from a display code for DB lookup.
 */
export function fromDisplayCode(displayCode: string): string {
  return displayCode.startsWith('RF') ? displayCode.slice(2) : displayCode;
}
