import { closureCovers } from '../stretches/closure-rules';

const at = new Date('2026-10-20T03:00:00Z');
const base = { stretch_id: 'S1', starts_at: new Date('2026-10-19T00:00:00Z'), ends_at: null as Date | null, revoked_at: null as Date | null };

describe('closure coverage', () => {
  it('indefinite stretch closure covers later departures on that stretch only', () => {
    expect(closureCovers(base, 'S1', at)).toBe(true);
    expect(closureCovers(base, 'S2', at)).toBe(false);
  });
  it('river-wide closure covers every stretch', () => {
    expect(closureCovers({ ...base, stretch_id: null }, 'S2', at)).toBe(true);
  });
  it('respects the time window and revocation', () => {
    expect(closureCovers({ ...base, ends_at: new Date('2026-10-20T02:00:00Z') }, 'S1', at)).toBe(false);
    expect(closureCovers({ ...base, starts_at: new Date('2026-10-21T00:00:00Z') }, 'S1', at)).toBe(false);
    expect(closureCovers({ ...base, revoked_at: new Date() }, 'S1', at)).toBe(false);
  });
});
