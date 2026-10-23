import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar, CheckCircle, Clock, MapPin, QrCode, ShieldCheck, Ticket, Users, Waves, LogOut } from 'lucide-react';
import {

  AvailabilityResponse,
  Booking,
  SlotView,
  Stretch,
  TicketPass,
  inr,
  istDateTime,
  istTime,
  newIdempotencyKey,
  publicApi,
  request,
  todayIst,
} from '../services/api';
import { getToken, signOut } from '../lib/phone-auth';
import { StretchBanner } from '../components/StretchBanner';
import { PhoneSignIn } from '../components/PhoneSignIn';
import { Button, ConfirmDialog, ErrorBanner, Field, Notice, Panel, Spinner, StatusPill, inputCls } from '../components/ui';

declare global {
  interface Window {
    Razorpay?: any;
  }
}

const SAFETY_DECLARATION_VERSION = 'v1.0';
const customerToken = () => getToken('customer');

function addDaysIso(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const CustomerBookingPage: React.FC = () => {
  const [stretches, setStretches] = useState<Stretch[] | null>(null);
  const [stretchId, setStretchId] = useState<string | null>(null);
  const [date, setDate] = useState(todayIst());
  const [availability, setAvailability] = useState<AvailabilityResponse | null>(null);
  const [slot, setSlot] = useState<SlotView | null>(null);
  const [loadErr, setLoadErr] = useState<unknown>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);

  const [signedIn, setSignedIn] = useState(false);
  const [showSignIn, setShowSignIn] = useState(false);
  const [myBookings, setMyBookings] = useState<Booking[] | null>(null);
  const [ticket, setTicket] = useState<TicketPass | null>(null);

  useEffect(() => {
    publicApi
      .stretches()
      .then((s) => {
        setStretches(s);
        const firstOpen = s.find((x) => x.status === 'OPEN' && x.live_trip_count > 0) ?? s[0];
        if (firstOpen) setStretchId(firstOpen.id);
      })
      .catch(setLoadErr);
    customerToken().then((t) => setSignedIn(!!t));
  }, []);

  const loadSlots = useCallback(() => {
    if (!stretchId) return;
    setLoadingSlots(true);
    setLoadErr(null);
    publicApi
      .slots(stretchId, date)
      .then((a) => {
        setAvailability(a);
        setSlot((cur) => a.slots.find((s) => s.id === cur?.id) ?? null);
      })
      .catch((e) => {
        setAvailability(null);
        setLoadErr(e);
      })
      .finally(() => setLoadingSlots(false));
  }, [stretchId, date]);

  useEffect(loadSlots, [loadSlots]);

  const loadMyBookings = useCallback(() => {
    if (!signedIn) return;
    request<Booking[]>('/bookings', { token: customerToken })
      .then(setMyBookings)
      .catch(() => setMyBookings([]));
  }, [signedIn]);
  useEffect(loadMyBookings, [loadMyBookings]);

  const stretch = stretches?.find((s) => s.id === stretchId) ?? null;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="text-center max-w-3xl mx-auto mb-8">
        <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white mb-3">
          Book white water rafting in <span className="text-teal-400">Rishikesh</span>
        </h1>
        <p className="text-slate-400 text-sm">Live availability from licensed operators. Seats are held for you while you pay.</p>
      </div>

      <div className="flex justify-end mb-3">
        {signedIn ? (
          <Button
            tone="ghost"
            onClick={async () => {
              await signOut('customer');
              setSignedIn(false);
              setMyBookings(null);
            }}
          >
            <LogOut className="w-3.5 h-3.5" /> Sign out
          </Button>
        ) : (
          <Button tone="ghost" onClick={() => setShowSignIn(true)}>
            Sign in to see my bookings
          </Button>
        )}
      </div>

      {showSignIn && !signedIn && (
        <div className="mb-6">
          <PhoneSignIn
            audience="customer"
            title="Sign in with your phone"
            onSignedIn={() => {
              setSignedIn(true);
              setShowSignIn(false);
            }}
          />
        </div>
      )}

      <ErrorBanner error={loadErr} onClose={() => setLoadErr(null)} />
      {!stretches && !loadErr && <Spinner label="Loading river stretches…" />}
      {stretches && <StretchBanner stretches={stretches} />}

      {stretches && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 space-y-6">
            <Panel title={<><Waves className="w-4 h-4 text-teal-400" /> 1. Choose a stretch</>}>
              {stretches.length === 0 && <p className="text-xs text-slate-400">No river stretches are currently offered.</p>}
              <div className="grid sm:grid-cols-2 gap-3">
                {stretches.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      setStretchId(s.id);
                      setSlot(null);
                    }}
                    className={`text-left p-4 rounded-xl border transition-all ${
                      s.id === stretchId ? 'border-teal-500 bg-teal-500/10' : 'border-slate-800 bg-slate-900 hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-white text-sm">{s.name}</span>
                      <StatusPill status={s.status} />
                    </div>
                    <div className="text-[11px] text-slate-400 mt-1">
                      {s.distance_km} km · {s.grade} · min age {s.min_age}
                    </div>
                    <div className="text-[11px] text-teal-300 mt-1">
                      {s.live_trip_count > 0 ? `From ${inr(s.from_price_paise)} per seat` : 'No operators listed yet'}
                    </div>
                  </button>
                ))}
              </div>
            </Panel>

            <Panel
              title={<><Calendar className="w-4 h-4 text-teal-400" /> 2. Pick a date &amp; departure</>}
              actions={
                <input
                  type="date"
                  className={`${inputCls} w-auto`}
                  value={date}
                  min={todayIst()}
                  max={addDaysIso(todayIst(), 60)}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setSlot(null);
                  }}
                />
              }
            >
              {loadingSlots && <Spinner label="Checking live availability…" />}
              {availability && !loadingSlots && (
                <>
                  {availability.slots.length === 0 && (
                    <p className="text-xs text-slate-400 py-4 text-center">No departures on this date for this stretch.</p>
                  )}
                  <div className="space-y-2">
                    {availability.slots.map((s) => (
                      <button
                        key={s.id}
                        disabled={!s.bookable}
                        onClick={() => setSlot(s)}
                        className={`w-full text-left p-4 rounded-xl border flex items-center justify-between gap-3 transition-all disabled:opacity-50 ${
                          slot?.id === s.id ? 'border-teal-500 bg-teal-500/10' : 'border-slate-800 bg-slate-900 hover:border-slate-600'
                        }`}
                      >
                        <div>
                          <div className="text-sm font-bold text-white flex items-center gap-2">
                            <Clock className="w-3.5 h-3.5 text-teal-400" /> {istTime(s.start_time)} – {istTime(s.end_time)} IST
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            {s.trip.title} · {s.trip.vendor.display_name}
                            {s.trip.vendor.licence_verified && <ShieldCheck className="inline w-3 h-3 ml-1 text-emerald-400" />}
                          </div>
                          {s.closure_reason && <div className="text-[11px] text-amber-300 mt-0.5">Closed: {s.closure_reason}</div>}
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-sm font-bold text-teal-300">{inr(s.per_seat_price_paise)}</div>
                          <div className="text-[10px] text-slate-400">{s.available_shared_seats} seats left</div>
                          {s.private_raft_price_paise != null && (
                            <div className="text-[10px] text-slate-500">{s.available_private_rafts} private rafts</div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-500 mt-3">{availability.note}</p>
                </>
              )}
            </Panel>
          </div>

          <div className="lg:col-span-5 space-y-6">
            {slot && stretch ? (
              <BookingForm
                key={slot.id}
                slot={slot}
                signedIn={signedIn}
                onNeedSignIn={() => setShowSignIn(true)}
                onBooked={() => {
                  loadSlots();
                  loadMyBookings();
                }}
                onTicket={setTicket}
              />
            ) : (
              <Panel title={<><Users className="w-4 h-4 text-teal-400" /> 3. Guests &amp; payment</>}>
                <p className="text-xs text-slate-400">Select an available departure to continue.</p>
              </Panel>
            )}
            {signedIn && <MyBookings bookings={myBookings} reload={loadMyBookings} onTicket={setTicket} />}
          </div>
        </div>
      )}

      {ticket && <TicketModal ticket={ticket} onClose={() => setTicket(null)} />}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────

const BookingForm: React.FC<{
  slot: SlotView;
  signedIn: boolean;
  onNeedSignIn: () => void;
  onBooked: () => void;
  onTicket: (t: TicketPass) => void;
}> = ({ slot, signedIn, onNeedSignIn, onBooked, onTicket }) => {
  const privateAvailable = slot.private_raft_price_paise != null && slot.available_private_rafts > 0;
  const [mode, setMode] = useState<'SHARED' | 'PRIVATE'>('SHARED');
  const maxSeats = mode === 'PRIVATE' ? slot.raft_capacity : Math.min(slot.available_shared_seats, 12);
  const [guests, setGuests] = useState<Array<{ name: string; age: string }>>([{ name: '', age: '' }]);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [idempotencyKey] = useState(newIdempotencyKey);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const setCount = (n: number) => {
    const count = Math.max(1, Math.min(maxSeats, n));
    setGuests((g) => (g.length > count ? g.slice(0, count) : [...g, ...Array.from({ length: count - g.length }, () => ({ name: '', age: '' }))]));
  };

  const amount = mode === 'PRIVATE' ? slot.private_raft_price_paise ?? 0 : slot.per_seat_price_paise * guests.length;
  const guestsValid = guests.every((g) => g.name.trim().length >= 2 && Number(g.age) >= slot.min_age && (slot.max_age == null || Number(g.age) <= slot.max_age));
  const holdLeft = booking ? Math.max(0, Math.floor((new Date(booking.hold_expires_at).getTime() - now) / 1000)) : 0;

  const pollUntilConfirmed = async (bookingId: string) => {
    for (let i = 0; i < 20; i++) {
      const b = await request<Booking>(`/bookings/${bookingId}`, { token: customerToken });
      setStatus(b.status);
      if (b.status === 'CONFIRMED') {
        onTicket(await request<TicketPass>(`/payments/bookings/${bookingId}/qr`, { token: customerToken }));
        onBooked();
        return;
      }
      if (b.status !== 'PENDING_PAYMENT') return;
      await new Promise((r) => setTimeout(r, 3000));
    }
    setErr(new Error('Payment received by the gateway is still being confirmed. Check "My bookings" in a minute.'));
  };

  const hold = async () => {
    setBusy(true);
    setErr(null);
    try {
      const b = await request<Booking>('/bookings', {
        token: customerToken,
        body: {
          slot_id: slot.id,
          mode,
          seat_count: mode === 'PRIVATE' ? 1 : guests.length,
          guests: guests.map((g) => ({ name: g.name.trim(), age: Number(g.age) })),
          safety_declaration_version: SAFETY_DECLARATION_VERSION,
          idempotency_key: idempotencyKey,
        },
      });
      setBooking(b);
      setStatus(b.status);
      onBooked();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  const pay = async () => {
    if (!booking) return;
    setBusy(true);
    setErr(null);
    try {
      const order = await request<{ razorpay_order_id: string; razorpay_key_id: string; amount_paise: number; currency: string; booking_code: string }>(
        '/payments/order',
        { token: customerToken, body: { booking_id: booking.id } },
      );
      if (!window.Razorpay) throw new Error('Razorpay Checkout failed to load. Check your connection and try again.');
      const rzp = new window.Razorpay({
        key: order.razorpay_key_id,
        amount: order.amount_paise,
        currency: order.currency,
        name: 'RaftNow',
        description: `Rafting booking RF${order.booking_code}`,
        order_id: order.razorpay_order_id,
        theme: { color: '#14b8a6' },
        handler: async (resp: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
          setBusy(true);
          try {
            await request('/payments/verify', { token: customerToken, body: { booking_id: booking.id, ...resp } });
            await pollUntilConfirmed(booking.id);
          } catch (e) {
            setErr(e);
          } finally {
            setBusy(false);
          }
        },
        modal: { ondismiss: () => setBusy(false) },
      });
      rzp.open();
    } catch (e) {
      setErr(e);
      setBusy(false);
    }
  };

  return (
    <Panel title={<><Users className="w-4 h-4 text-teal-400" /> 3. Guests &amp; payment</>}>
      <div className="text-xs text-slate-300 mb-3">
        <div className="font-bold text-white">{slot.trip.title}</div>
        <div className="flex items-center gap-1 text-slate-400">
          <MapPin className="w-3 h-3" /> {slot.trip.meeting_point}
        </div>
        <div className="text-slate-400">
          {istDateTime(slot.start_time)} IST · age {slot.min_age}
          {slot.max_age ? `–${slot.max_age}` : '+'}
        </div>
      </div>
      <ErrorBanner error={err} onClose={() => setErr(null)} />

      {!booking && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <Button tone={mode === 'SHARED' ? 'primary' : 'ghost'} onClick={() => setMode('SHARED')}>
              Shared seats ({inr(slot.per_seat_price_paise)}/seat)
            </Button>
            {slot.private_raft_price_paise != null && (
              <Button tone={mode === 'PRIVATE' ? 'primary' : 'ghost'} disabled={!privateAvailable} onClick={() => setMode('PRIVATE')}>
                Private raft ({inr(slot.private_raft_price_paise)})
              </Button>
            )}
          </div>
          <Field label={mode === 'PRIVATE' ? `Guests (max ${slot.raft_capacity})` : 'Seats'}>
            <input type="number" className={inputCls} min={1} max={maxSeats} value={guests.length} onChange={(e) => setCount(Number(e.target.value))} />
          </Field>
          {guests.map((g, i) => (
            <div key={i} className="grid grid-cols-3 gap-2">
              <input
                className={`${inputCls} col-span-2`}
                placeholder={i === 0 ? 'Lead guest full name' : `Guest ${i + 1} name`}
                value={g.name}
                onChange={(e) => setGuests((all) => all.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
              />
              <input
                className={inputCls}
                type="number"
                placeholder="Age"
                value={g.age}
                onChange={(e) => setGuests((all) => all.map((x, j) => (j === i ? { ...x, age: e.target.value } : x)))}
              />
            </div>
          ))}
          <label className="flex items-start gap-2 text-[11px] text-slate-300">
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5" />
            I confirm every guest can swim or will wear a life jacket at all times, meets the age limit, and follows the guide's safety
            briefing (safety declaration {SAFETY_DECLARATION_VERSION}).
          </label>
          <div className="flex items-center justify-between border-t border-slate-800 pt-3">
            <div>
              <div className="text-[10px] uppercase text-slate-500 font-bold">Total</div>
              <div className="text-xl font-extrabold text-white">{inr(amount)}</div>
              <div className="text-[10px] text-slate-500">Final amount is confirmed by the server when your seats are held.</div>
            </div>
            {signedIn ? (
              <Button busy={busy} disabled={!guestsValid || !accepted} onClick={hold}>
                Hold seats
              </Button>
            ) : (
              <Button onClick={onNeedSignIn}>Sign in to book</Button>
            )}
          </div>
          {!guestsValid && guests.some((g) => g.age) && (
            <p className="text-[10px] text-amber-300">Every guest needs a name and an age within the allowed range.</p>
          )}
        </div>
      )}

      {booking && (
        <div className="space-y-3">
          <Notice tone={status === 'PENDING_PAYMENT' && holdLeft > 0 ? 'info' : status === 'CONFIRMED' ? 'ok' : 'warn'}>
            Booking <span className="font-mono font-bold">{booking.display_code}</span> — <StatusPill status={status ?? booking.status} />
            {status === 'PENDING_PAYMENT' && (
              <div className="mt-1">
                {holdLeft > 0
                  ? `Seats held for ${Math.floor(holdLeft / 60)}:${String(holdLeft % 60).padStart(2, '0')} — complete payment before the hold expires.`
                  : 'Hold expired. Start again to re-check availability.'}
              </div>
            )}
          </Notice>
          <div className="flex items-center justify-between">
            <div className="text-lg font-extrabold text-white">{inr(booking.amount_paise)}</div>
            {status === 'PENDING_PAYMENT' && holdLeft > 0 && (
              <Button busy={busy} onClick={pay}>
                <Ticket className="w-3.5 h-3.5" /> Pay with Razorpay
              </Button>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
};

// ─────────────────────────────────────────────────────────────────────────────

const MyBookings: React.FC<{ bookings: Booking[] | null; reload: () => void; onTicket: (t: TicketPass) => void }> = ({
  bookings,
  reload,
  onTicket,
}) => {
  const [cancelFor, setCancelFor] = useState<Booking | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const visible = useMemo(() => (bookings ?? []).filter((b) => b.status !== 'EXPIRED'), [bookings]);

  return (
    <Panel title={<><Ticket className="w-4 h-4 text-teal-400" /> My bookings</>}>
      <ErrorBanner error={err} onClose={() => setErr(null)} />
      {!bookings && <Spinner />}
      {bookings && visible.length === 0 && <p className="text-xs text-slate-400">No bookings yet.</p>}
      <div className="space-y-2 max-h-96 overflow-y-auto custom-scrollbar">
        {visible.map((b) => (
          <div key={b.id} className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-mono font-bold text-teal-300">{b.display_code}</span>
              <StatusPill status={b.status} />
            </div>
            <div className="text-slate-300 mt-1">{b.slot?.trip.title}</div>
            <div className="text-slate-500">
              {b.slot ? `${istDateTime(b.slot.start_time)} IST` : ''} · {b.seat_count} {b.mode === 'PRIVATE' ? 'pax (private raft)' : 'seats'} · {inr(b.amount_paise)}
            </div>
            {b.refunds && b.refunds.length > 0 && (
              <div className="text-slate-400 mt-1">
                Refund {inr(b.refunds[0].amount_paise)} — <StatusPill status={b.refunds[0].status} />
              </div>
            )}
            <div className="flex gap-2 mt-2">
              {(b.status === 'CONFIRMED' || b.status === 'CHECKED_IN') && (
                <Button
                  tone="ghost"
                  onClick={() =>
                    request<TicketPass>(`/payments/bookings/${b.id}/qr`, { token: customerToken }).then(onTicket).catch(setErr)
                  }
                >
                  <QrCode className="w-3.5 h-3.5" /> Ticket
                </Button>
              )}
              {(b.status === 'CONFIRMED' || b.status === 'PENDING_PAYMENT') && (
                <Button tone="danger" onClick={() => setCancelFor(b)}>
                  Cancel
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
      {cancelFor && (
        <ConfirmDialog
          title={`Cancel ${cancelFor.display_code}?`}
          body={
            <>
              Refund policy: more than 24h before departure — 100%; 6–24h — 50%; under 6h — no refund. The refund is calculated by the
              server at the moment you confirm.
            </>
          }
          confirmLabel="Cancel booking"
          requireReason={false}
          onConfirm={async () => {
            await request(`/bookings/${cancelFor.id}`, { method: 'DELETE', token: customerToken });
            reload();
          }}
          onClose={() => setCancelFor(null)}
        />
      )}
    </Panel>
  );
};

const TicketModal: React.FC<{ ticket: TicketPass; onClose: () => void }> = ({ ticket, onClose }) => (
  <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4" role="dialog" aria-modal="true">
    <div className="bg-slate-900 border border-teal-500/30 rounded-3xl p-6 max-w-sm w-full">
      <div className="text-center mb-4">
        <CheckCircle className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
        <h2 className="text-xl font-extrabold text-white">Your rafting ticket</h2>
        <p className="text-xs text-slate-400">Show this QR at the meeting point. It is signed by RaftNow and checked by the operator.</p>
      </div>
      <img src={ticket.qr_data_url} alt="Signed booking QR code" className="w-56 h-56 mx-auto rounded-xl bg-white p-2" />
      <div className="text-center font-mono text-lg font-bold text-teal-300 mt-2">{ticket.display_code}</div>
      <div className="text-center mt-1">
        <StatusPill status={ticket.status} />
      </div>
      <div className="text-xs text-slate-300 space-y-1 mt-4 border-t border-slate-800 pt-3">
        <div>{ticket.trip_title} · {ticket.vendor_name}</div>
        <div>{istDateTime(ticket.start_time)} IST</div>
        <div>Meet: {ticket.meeting_point}</div>
        <div>Guests: {ticket.guests.map((g) => g.name).join(', ')}</div>
      </div>
      <div className="flex gap-2 mt-4">
        <Button tone="ghost" className="flex-1" onClick={() => window.print()}>
          Print
        </Button>
        <Button className="flex-1" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  </div>
);

