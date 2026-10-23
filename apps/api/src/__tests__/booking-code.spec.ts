import {
  generateBookingCode,
  isValidBookingCode,
  toDisplayCode,
  fromDisplayCode,
  BOOKING_CODE_ALPHABET,
  BOOKING_CODE_LENGTH,
} from '@raftnow/shared';

describe('generateBookingCode', () => {
  it('generates a code of exactly 6 characters', () => {
    const code = generateBookingCode();
    expect(code).toHaveLength(BOOKING_CODE_LENGTH);
  });

  it('only uses characters from the safe alphabet', () => {
    const validChars = new Set(BOOKING_CODE_ALPHABET.split(''));
    for (let i = 0; i < 100; i++) {
      const code = generateBookingCode();
      for (const char of code) {
        expect(validChars.has(char)).toBe(true);
      }
    }
  });

  it('excludes look-alike characters (0, O, 1, I, L)', () => {
    const forbidden = new Set(['0', 'O', '1', 'I', 'L']);
    for (let i = 0; i < 1000; i++) {
      const code = generateBookingCode();
      for (const char of code) {
        expect(forbidden.has(char)).toBe(false);
      }
    }
  });

  it('generates unique codes (probabilistic — collision is astronomically unlikely)', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 10000; i++) {
      codes.add(generateBookingCode());
    }
    // All 10000 codes should be unique (collision probability ≈ 1 in 10^9)
    expect(codes.size).toBe(10000);
  });
});

describe('isValidBookingCode', () => {
  it('validates correct codes', () => {
    expect(isValidBookingCode('ABC234')).toBe(true);
    expect(isValidBookingCode('XYZR89')).toBe(true);
  });

  it('rejects codes with look-alike characters', () => {
    expect(isValidBookingCode('OBC234')).toBe(false); // O
    expect(isValidBookingCode('1BC234')).toBe(false); // 1
    expect(isValidBookingCode('0BC234')).toBe(false); // 0
    expect(isValidBookingCode('LBC234')).toBe(false); // L
    expect(isValidBookingCode('IBC234')).toBe(false); // I
  });

  it('rejects codes of wrong length', () => {
    expect(isValidBookingCode('ABCDE')).toBe(false);   // too short
    expect(isValidBookingCode('ABCDEFG')).toBe(false); // too long
    expect(isValidBookingCode('')).toBe(false);        // empty
  });

  it('rejects lowercase', () => {
    expect(isValidBookingCode('abc234')).toBe(false);
  });

  it('validates all generated codes', () => {
    for (let i = 0; i < 100; i++) {
      const code = generateBookingCode();
      expect(isValidBookingCode(code)).toBe(true);
    }
  });
});

describe('display code conversion', () => {
  it('adds RF prefix', () => {
    expect(toDisplayCode('ABC234')).toBe('RFABC234');
  });

  it('strips RF prefix', () => {
    expect(fromDisplayCode('RFABC234')).toBe('ABC234');
  });

  it('fromDisplayCode is idempotent without prefix', () => {
    expect(fromDisplayCode('ABC234')).toBe('ABC234');
  });
});
