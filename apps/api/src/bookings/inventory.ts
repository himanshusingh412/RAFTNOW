/**
 * Slot inventory arithmetic — pure functions shared by the booking transaction
 * (authoritative, under a row lock) and the public availability API (advisory).
 *
 * Shared seats and private rafts come out of the SAME physical rafts:
 *   seats_booked + seats_held + (private_rafts_booked + private_rafts_held) * raft_capacity <= total_seats
 * This mirrors the chk_combined_capacity database constraint.
 */
export interface SlotCounters {
  total_rafts: number;
  raft_capacity: number;
  total_seats: number;
  seats_booked: number;
  seats_held: number;
  private_rafts_booked: number;
  private_rafts_held: number;
}

export function privateRaftsConsumed(s: SlotCounters): number {
  return s.private_rafts_booked + s.private_rafts_held;
}

export function sharedSeatsConsumed(s: SlotCounters): number {
  return s.seats_booked + s.seats_held;
}

/** Seats still sellable as individual shared seats. */
export function availableSharedSeats(s: SlotCounters): number {
  const free = s.total_seats - sharedSeatsConsumed(s) - privateRaftsConsumed(s) * s.raft_capacity;
  return Math.max(0, free);
}

/** Whole rafts with no shared passengers and no private booking. */
export function availablePrivateRafts(s: SlotCounters): number {
  if (s.raft_capacity <= 0) return 0;
  const raftsUsedByShared = Math.ceil(sharedSeatsConsumed(s) / s.raft_capacity);
  return Math.max(0, s.total_rafts - raftsUsedByShared - privateRaftsConsumed(s));
}

/** True when the counters satisfy every database inventory constraint. */
export function countersAreValid(s: SlotCounters): boolean {
  return (
    s.seats_booked >= 0 &&
    s.seats_held >= 0 &&
    s.private_rafts_booked >= 0 &&
    s.private_rafts_held >= 0 &&
    s.total_seats === s.total_rafts * s.raft_capacity &&
    s.seats_booked + s.seats_held <= s.total_seats &&
    privateRaftsConsumed(s) <= s.total_rafts &&
    sharedSeatsConsumed(s) + privateRaftsConsumed(s) * s.raft_capacity <= s.total_seats
  );
}
