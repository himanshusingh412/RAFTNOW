import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, CheckCircle, ChevronDown, Clock, LogOut, MapPin, QrCode, Search, ShieldCheck, Ticket, Users, Waves } from 'lucide-react';
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
import { Button, ConfirmDialog, ErrorBanner, Field, Notice, Panel, Spinner, StatusPill, useInputCls } from '../components/ui';

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

/** "24 Oct'26" and "Saturday" for a YYYY-MM-DD date. */
function dayParts(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return { big: `${day}'${String(d.getUTCFullYear()).slice(2)}`, weekday: d.toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' }) };
}

/**
 * One box of the search card: small caps label, big value, small detail. The
 * native control is laid invisibly over the box, so it keeps native keyboard,
 * screen-reader and mobile picker behaviour.
 */
const SearchField: React.FC<{ label: string; value: React.ReactNode; detail?: React.ReactNode; children: React.ReactNode; className?: string }> = ({
  label,
  value,
  detail,
  children,
  className = '',
}) => (
  <div className={`relative px-5 py-4 hover:bg-blue-50/60 focus-within:bg-blue-50/60 transition-colors ${className}`}>
    <div className="text-xs font-semibold text-neutral-500 flex items-center gap-1">
      {label} <ChevronDown className="w-3.5 h-3.5 text-[#008cff]" aria-hidden />
    </div>
    <div className="text-2xl font-black text-neutral-900 mt-1 truncate">{value}</div>
    {detail && <div className="text-sm text-neutral-600 truncate">{detail}</div>}
    {children}
  </div>
);

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
  const resultsRef = useRef<HTMLDivElement>(null);

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
  const day = dayParts(date);

  return (
    <div>
      {/* Hero */}
      <section className="bg-gradient-to-br from-[#051322] via-[#0b2a4a] to-[#15457c] pt-10 pb-32 px-4">
        <div className="max-w-6xl mx-auto flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-white">White water rafting in Rishikesh</h1>
            <p className="text-blue-100/80 mt-2">Licensed operators · live seats · instant confirmation</p>
          </div>
          {signedIn ? (
            <button
              className="text-sm font-semibold text-white/90 hover:text-white inline-flex items-center gap-1.5 px-3 py-2 rounded-full border border-white/30 hover:bg-white/10"
              onClick={async () => {
                await signOut('customer');
                setSignedIn(false);
                setMyBookings(null);
              }}
            >
              <LogOut className="w-4 h-4" /> Log out
            </button>
          ) : (
            <button
              className="text-sm font-bold text-white inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-white/10 border border-white/30 hover:bg-white/20"
              onClick={() => setShowSignIn(true)}
            >
              Login or create account
            </button>
          )}
        </div>
      </section>

      {/* Search card overlapping the hero */}
      <div className="max-w-6xl mx-auto px-4 -mt-24 relative">
        <div className="bg-white rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.15)] pb-8">
          <div className="flex items-center gap-2 px-5 pt-4 pb-3 border-b border-neutral-200">
            <span className="inline-flex items-center gap-1.5 text-sm font-bold text-[#008cff] border-b-2 border-[#008cff] pb-2 -mb-[13px]">
              <Waves className="w-4 h-4" /> River rafting
            </span>
          </div>
          {!stretches && !loadErr && (
            <div className="px-5">
              <Spinner label="Loading river stretches…" />
            </div>
          )}
          {stretches && (
            <div className="grid grid-cols-1 md:grid-cols-[2fr_1.3fr_1fr] divide-y md:divide-y-0 md:divide-x divide-neutral-200 border-b border-neutral-200">
              <SearchField
                label="River stretch"
                value={stretch ? stretch.name.replace(' → Rishikesh', '') : 'Choose a stretch'}
                detail={stretch ? `${stretch.distance_km} km · ${stretch.grade} · age ${stretch.min_age}+` : undefined}
              >
                <select
                  aria-label="River stretch"
                  className="absolute inset-0 opacity-0 cursor-pointer w-full"
                  value={stretchId ?? ''}
                  onChange={(e) => {
                    setStretchId(e.target.value);
                    setSlot(null);
                  }}
                >
                  {stretches.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.status === 'CLOSED' ? ' (closed)' : s.live_trip_count === 0 ? ' (no operators yet)' : ` · from ${inr(s.from_price_paise)}`}
                    </option>
                  ))}
                </select>
              </SearchField>
              <SearchField label="Date" value={day.big} detail={day.weekday}>
                <input
                  type="date"
                  aria-label="Date"
                  className="absolute inset-0 opacity-0 cursor-pointer w-full"
                  value={date}
                  min={todayIst()}
                  max={addDaysIso(todayIst(), 60)}
                  onChange={(e) => {
                    if (!e.target.value) return;
                    setDate(e.target.value);
                    setSlot(null);
                  }}
                />
              </SearchField>
              <div className="px-5 py-4">
                <div className="text-xs font-semibold text-neutral-500">Starting from</div>
                <div className="text-2xl font-black text-neutral-900 mt-1">{stretch?.live_trip_count ? inr(stretch.from_price_paise) : '—'}</div>
                <div className="text-sm text-neutral-600">per person, taxes included</div>
              </div>
            </div>
          )}
        </div>
        <div className="flex justify-center -mt-7 relative">
          <button
            onClick={() => {
              loadSlots();
              resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            disabled={!stretchId}
            className="inline-flex items-center gap-2 px-14 py-3.5 rounded-full text-white text-xl font-black tracking-wider uppercase bg-gradient-to-r from-[#53b2fe] to-[#065af3] shadow-lg shadow-blue-600/30 hover:brightness-105 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#008cff]"
          >
            <Search className="w-5 h-5" /> Search
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 mt-10">
        {showSignIn && !signedIn && (
          <div className="mb-6">
            <PhoneSignIn
              audience="customer"
              title="Login or create an account"
              onSignedIn={() => {
                setSignedIn(true);
                setShowSignIn(false);
              }}
            />
          </div>
        )}
        <ErrorBanner error={loadErr} onClose={() => setLoadErr(null)} />
        {stretches && <StretchBanner stretches={stretches} />}

        {stretches && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6" ref={resultsRef}>
            <div className="lg:col-span-7 scroll-mt-24">
              <div className="flex items-baseline justify-between mb-3">
                <h2 className="text-xl font-extrabold text-neutral-900">
                  {stretch ? stretch.name : 'Departures'} · {day.big}
                </h2>
                {availability && !loadingSlots && (
                  <span className="text-sm text-neutral-500">
                    {availability.slots.length} departure{availability.slots.length === 1 ? '' : 's'}
                  </span>
                )}
              </div>
              {loadingSlots && <Spinner label="Checking live availability…" />}
              {availability && !loadingSlots && (
                <>
                  {availability.slots.length === 0 && (
                    <div className="bg-white rounded-xl p-8 text-center shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
                      <Calendar className="w-8 h-8 text-[#008cff] mx-auto mb-2" />
                      <div className="font-bold text-neutral-900">No departures on this date</div>
                      <div className="text-sm text-neutral-600 mt-1">Try another date or river stretch.</div>
                    </div>
                  )}
                  <div className="space-y-3">
                    {availability.slots.map((s) => {
                      const selected = slot?.id === s.id;
                      const few = s.available_shared_seats > 0 && s.available_shared_seats <= 6;
                      return (
                        <button
                          key={s.id}
                          disabled={!s.bookable}
                          onClick={() => setSlot(s)}
                          aria-pressed={selected}
                          className={`w-full text-left bg-white rounded-xl p-4 transition-shadow border-2 disabled:opacity-60 disabled:cursor-not-allowed ${
                            selected ? 'border-[#008cff] shadow-[0_4px_16px_rgba(0,140,255,0.18)]' : 'border-transparent shadow-[0_2px_12px_rgba(0,0,0,0.08)] hover:shadow-[0_4px_18px_rgba(0,0,0,0.12)]'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <div className="font-extrabold text-neutral-900 text-lg truncate">{s.trip.title}</div>
                              <div className="text-sm text-neutral-600 truncate">by {s.trip.vendor.display_name}</div>
                              <div className="flex flex-wrap items-center gap-2 mt-2">
                                {s.trip.vendor.licence_verified && (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-green-800 bg-green-50 px-1.5 py-0.5 rounded">
                                    <ShieldCheck className="w-3 h-3" /> Licensed
                                  </span>
                                )}
                                <span className="text-[11px] font-bold text-neutral-700 bg-neutral-100 px-1.5 py-0.5 rounded">Age {s.min_age}{s.max_age ? `–${s.max_age}` : '+'}</span>
                              </div>
                              <div className="flex items-center gap-1.5 mt-3 text-neutral-900 font-bold">
                                <Clock className="w-4 h-4 text-neutral-500" /> {istTime(s.start_time)} – {istTime(s.end_time)}
                              </div>
                              {s.closure_reason && <div className="text-sm text-amber-800 mt-1">Closed: {s.closure_reason}</div>}
                            </div>
                            <div className="text-right shrink-0">
                              <div className="text-2xl font-black text-neutral-900">{inr(s.per_seat_price_paise)}</div>
                              <div className="text-xs text-neutral-500">per person</div>
                              <div className={`text-sm font-bold mt-2 ${few ? 'text-red-700' : 'text-green-700'}`}>
                                {s.bookable ? (few ? `Only ${s.available_shared_seats} left!` : `${s.available_shared_seats} seats left`) : 'Not available'}
                              </div>
                              {s.private_raft_price_paise != null && (
                                <div className="text-xs text-neutral-500">{s.available_private_rafts} private raft{s.available_private_rafts === 1 ? '' : 's'} · {inr(s.private_raft_price_paise)}</div>
                              )}
                              {s.bookable && (
                                <span
                                  className={`inline-block mt-2 text-xs font-black uppercase tracking-wide px-4 py-1.5 rounded-full ${
                                    selected ? 'bg-[#008cff] text-white' : 'border-2 border-[#008cff] text-[#008cff]'
                                  }`}
                                >
                                  {selected ? 'Selected' : 'Select'}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-neutral-500 mt-3">{availability.note}</p>
                </>
              )}
            </div>

            <div className="lg:col-span-5 space-y-6 lg:sticky lg:top-20 self-start">
              {slot && stretch ? (
                <BookingForm
                  key={slot.id}
                  slot={slot}
                  signedIn={signedIn}
                  onNeedSignIn={() => {
                    setShowSignIn(true);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  onBooked={() => {
                    loadSlots();
                    loadMyBookings();
                  }}
                  onTicket={setTicket}
                />
              ) : (
                <Panel title={<><Users className="w-5 h-5 text-[#008cff]" /> Guests &amp; payment</>}>
                  <p className="text-sm text-neutral-600">Select a departure to add guests and pay.</p>
                </Panel>
              )}
              {signedIn && <MyBookings bookings={myBookings} reload={loadMyBookings} onTicket={setTicket} />}
            </div>
          </div>
        )}
      </div>

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
  const inputCls = useInputCls();
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
        theme: { color: '#008cff' },
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

  const segment = (active: boolean) =>
    `flex-1 px-3 py-2.5 rounded-lg text-sm font-bold border-2 transition-colors disabled:opacity-50 ${
      active ? 'border-[#008cff] bg-blue-50 text-[#008cff]' : 'border-neutral-200 text-neutral-700 hover:border-neutral-300'
    }`;

  return (
    <Panel title={<><Users className="w-5 h-5 text-[#008cff]" /> Guests &amp; payment</>}>
      <div className="rounded-lg bg-neutral-50 border border-neutral-200 p-3 mb-4 text-sm">
        <div className="font-bold text-neutral-900">{slot.trip.title}</div>
        <div className="flex items-center gap-1 text-neutral-600">
          <MapPin className="w-3.5 h-3.5" /> {slot.trip.meeting_point}
        </div>
        <div className="text-neutral-600">
          {istDateTime(slot.start_time)} IST · age {slot.min_age}
          {slot.max_age ? `–${slot.max_age}` : '+'}
        </div>
      </div>
      <ErrorBanner error={err} onClose={() => setErr(null)} />

      {!booking && (
        <div className="space-y-4">
          <div className="flex gap-2" role="group" aria-label="Raft type">
            <button type="button" className={segment(mode === 'SHARED')} aria-pressed={mode === 'SHARED'} onClick={() => setMode('SHARED')}>
              Shared · {inr(slot.per_seat_price_paise)}/seat
            </button>
            {slot.private_raft_price_paise != null && (
              <button type="button" className={segment(mode === 'PRIVATE')} aria-pressed={mode === 'PRIVATE'} disabled={!privateAvailable} onClick={() => setMode('PRIVATE')}>
                Private raft · {inr(slot.private_raft_price_paise)}
              </button>
            )}
          </div>
          <Field label={mode === 'PRIVATE' ? `Guests (max ${slot.raft_capacity})` : 'Seats'}>
            <input type="number" className={inputCls} min={1} max={maxSeats} value={guests.length} onChange={(e) => setCount(Number(e.target.value))} />
          </Field>
          <div className="space-y-2">
            {guests.map((g, i) => (
              <div key={i} className="grid grid-cols-3 gap-2">
                <input
                  className={`${inputCls} col-span-2`}
                  aria-label={i === 0 ? 'Lead guest full name' : `Guest ${i + 1} name`}
                  placeholder={i === 0 ? 'Lead guest full name' : `Guest ${i + 1} name`}
                  value={g.name}
                  onChange={(e) => setGuests((all) => all.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                />
                <input
                  className={inputCls}
                  type="number"
                  aria-label={`Guest ${i + 1} age`}
                  placeholder="Age"
                  value={g.age}
                  onChange={(e) => setGuests((all) => all.map((x, j) => (j === i ? { ...x, age: e.target.value } : x)))}
                />
              </div>
            ))}
          </div>
          <label className="flex items-start gap-2.5 text-sm text-neutral-700">
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-1 w-4 h-4 accent-[#008cff]" />
            <span>
              I confirm every guest can swim or will wear a life jacket at all times, meets the age limit, and follows the guide's safety briefing
              (safety declaration {SAFETY_DECLARATION_VERSION}).
            </span>
          </label>
          {!guestsValid && guests.some((g) => g.age) && (
            <p className="text-sm text-amber-800">Every guest needs a name and an age within the allowed range.</p>
          )}
          <div className="flex items-center justify-between gap-3 border-t border-neutral-200 pt-4">
            <div>
              <div className="text-2xl font-black text-neutral-900">{inr(amount)}</div>
              <div className="text-xs text-neutral-500">Total · taxes included · confirmed when seats are held</div>
            </div>
            {signedIn ? (
              <Button busy={busy} disabled={!guestsValid || !accepted} onClick={hold} className="px-6 py-3">
                Book now
              </Button>
            ) : (
              <Button onClick={onNeedSignIn} className="px-6 py-3">
                Login to book
              </Button>
            )}
          </div>
        </div>
      )}

      {booking && (
        <div className="space-y-3">
          <Notice tone={status === 'PENDING_PAYMENT' && holdLeft > 0 ? 'info' : status === 'CONFIRMED' ? 'ok' : 'warn'}>
            Booking <span className="font-mono font-bold">{booking.display_code}</span> — <StatusPill status={status ?? booking.status} />
            {status === 'PENDING_PAYMENT' && (
              <div className="mt-1">
                {holdLeft > 0
                  ? `Seats held for ${Math.floor(holdLeft / 60)}:${String(holdLeft % 60).padStart(2, '0')}. Complete payment before the hold expires.`
                  : 'Hold expired. Start again to re-check availability.'}
              </div>
            )}
          </Notice>
          <div className="flex items-center justify-between">
            <div className="text-2xl font-black text-neutral-900">{inr(booking.amount_paise)}</div>
            {status === 'PENDING_PAYMENT' && holdLeft > 0 && (
              <Button busy={busy} onClick={pay} className="px-6 py-3">
                <Ticket className="w-4 h-4" /> Pay now
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
    <Panel title={<><Ticket className="w-5 h-5 text-[#008cff]" /> My trips</>}>
      <ErrorBanner error={err} onClose={() => setErr(null)} />
      {!bookings && <Spinner />}
      {bookings && visible.length === 0 && <p className="text-sm text-neutral-600">No bookings yet.</p>}
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {visible.map((b) => (
          <div key={b.id} className="p-3 rounded-lg border border-neutral-200 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-mono font-bold text-[#008cff]">{b.display_code}</span>
              <StatusPill status={b.status} />
            </div>
            <div className="text-neutral-900 font-semibold mt-1">{b.slot?.trip.title}</div>
            <div className="text-neutral-600">
              {b.slot ? `${istDateTime(b.slot.start_time)} IST` : ''} · {b.seat_count} {b.mode === 'PRIVATE' ? 'pax (private raft)' : 'seats'} · {inr(b.amount_paise)}
            </div>
            {b.refunds && b.refunds.length > 0 && (
              <div className="text-neutral-600 mt-1">
                Refund {inr(b.refunds[0].amount_paise)} — <StatusPill status={b.refunds[0].status} />
              </div>
            )}
            <div className="flex gap-2 mt-2">
              {(b.status === 'CONFIRMED' || b.status === 'CHECKED_IN') && (
                <Button tone="ghost" onClick={() => request<TicketPass>(`/payments/bookings/${b.id}/qr`, { token: customerToken }).then(onTicket).catch(setErr)}>
                  <QrCode className="w-4 h-4" /> Ticket
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
              Refund policy: more than 24h before departure — 100%; 6–24h — 50%; under 6h — no refund. The refund is calculated by the server at the
              moment you confirm.
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
  <div className="fixed inset-0 z-50 bg-neutral-900/50 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Your rafting ticket">
    <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden">
      <div className="bg-gradient-to-br from-[#051322] to-[#15457c] px-6 py-5 text-center">
        <CheckCircle className="w-8 h-8 text-green-400 mx-auto mb-2" />
        <h2 className="text-xl font-black text-white">Your rafting ticket</h2>
        <p className="text-sm text-blue-100/80">Show this QR at the meeting point.</p>
      </div>
      <div className="p-6">
        <img src={ticket.qr_data_url} alt="Signed booking QR code" className="w-56 h-56 mx-auto" />
        <div className="text-center font-mono text-2xl font-black tracking-widest text-neutral-900 mt-2">{ticket.display_code}</div>
        <div className="text-center mt-1">
          <StatusPill status={ticket.status} />
        </div>
        <div className="text-sm text-neutral-700 space-y-1 mt-4 border-t border-neutral-200 pt-3">
          <div className="font-bold text-neutral-900">
            {ticket.trip_title} · {ticket.vendor_name}
          </div>
          <div>{istDateTime(ticket.start_time)} IST</div>
          <div>Meet: {ticket.meeting_point}</div>
          <div>Guests: {ticket.guests.map((g) => g.name).join(', ')}</div>
        </div>
        <div className="flex gap-2 mt-5">
          <Button tone="ghost" className="flex-1" onClick={() => window.print()}>
            Print
          </Button>
          <Button className="flex-1" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  </div>
);
