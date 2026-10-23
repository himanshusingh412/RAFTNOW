import { availablePrivateRafts, availableSharedSeats, countersAreValid, SlotCounters } from '../bookings/inventory';

const slot = (o: Partial<SlotCounters> = {}): SlotCounters => ({
  total_rafts: 3, raft_capacity: 8, total_seats: 24, seats_booked: 0, seats_held: 0, private_rafts_booked: 0, private_rafts_held: 0, ...o,
});

describe('slot inventory arithmetic', () => {
  it('empty slot: all seats and rafts available', () => {
    expect(availableSharedSeats(slot())).toBe(24);
    expect(availablePrivateRafts(slot())).toBe(3);
  });

  it('private rafts reduce shared seats (the overbooking bug in the old code)', () => {
    const s = slot({ private_rafts_booked: 1, private_rafts_held: 1 });
    expect(availableSharedSeats(s)).toBe(8);
    expect(availablePrivateRafts(s)).toBe(1);
  });

  it('shared passengers occupy whole rafts for private availability', () => {
    expect(availablePrivateRafts(slot({ seats_booked: 7 }))).toBe(2);
    expect(availablePrivateRafts(slot({ seats_booked: 9 }))).toBe(1);
    expect(availablePrivateRafts(slot({ seats_booked: 17 }))).toBe(0);
  });

  it('never negative', () => {
    expect(availableSharedSeats(slot({ seats_booked: 24, private_rafts_booked: 1 }))).toBe(0);
    expect(availablePrivateRafts(slot({ private_rafts_booked: 3, seats_booked: 1 }))).toBe(0);
  });

  it('countersAreValid mirrors the DB CHECK constraints', () => {
    expect(countersAreValid(slot({ seats_booked: 16, private_rafts_booked: 1 }))).toBe(true);
    expect(countersAreValid(slot({ seats_booked: 17, private_rafts_booked: 1 }))).toBe(false);
    expect(countersAreValid(slot({ seats_held: -1 }))).toBe(false);
    expect(countersAreValid(slot({ total_seats: 23 }))).toBe(false);
  });

  it('booking the advertised availability never violates constraints', () => {
    for (let booked = 0; booked <= 24; booked++) {
      for (let priv = 0; priv <= 3; priv++) {
        const s = slot({ seats_booked: booked, private_rafts_booked: priv });
        if (!countersAreValid(s)) continue;
        const free = availableSharedSeats(s);
        expect(countersAreValid({ ...s, seats_held: free })).toBe(true);
        if (availablePrivateRafts(s) > 0) expect(countersAreValid({ ...s, private_rafts_held: 1 })).toBe(true);
      }
    }
  });
});
