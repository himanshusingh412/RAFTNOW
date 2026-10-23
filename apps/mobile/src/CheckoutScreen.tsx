import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { api, ApiError, CustomerBooking, PaymentOrder, SlotView, Ticket, TripDetail, inr, istTime, uuid } from './api';
import { CheckoutError, openCheckout } from './payments';
import type { Mode } from './TripScreen';
import { Banner, Button, Card, Header, Row, c, ui } from './ui';

/** Must match the declaration text version the API records (C-09). */
export const SAFETY_DECLARATION_VERSION = 'v1.0';

const DECLARATION = [
  'Every guest is within the trip’s age limits.',
  'No guest is pregnant or has a heart condition, epilepsy, a recent injury or surgery, or a back or neck problem.',
  'No guest has had alcohol or drugs before the trip.',
  'Every guest will wear a helmet and life jacket at all times and follow the guide’s instructions.',
  'I understand that guests who fail these rules at the put-in point can be refused without a refund.',
];

type Guest = { name: string; age: string };

function ageOk(age: string, min: number, max: number | null) {
  const n = Number(age);
  return age.trim() !== '' && Number.isInteger(n) && n >= min && (max == null || n <= max);
}

/**
 * Checkout (J1 steps 4–7): guest names and ages, safety declaration, price
 * breakdown, then hold seats → Razorpay → verify → ticket. The server holds
 * the seats for 10 minutes and computes the price; the app only displays it.
 */
export function CheckoutScreen({
  slot,
  trip,
  mode,
  guestCount,
  phone,
  onNeedSignIn,
  onBack,
  onConfirmed,
}: {
  slot: SlotView;
  trip: TripDetail;
  mode: Mode;
  guestCount: number;
  phone: string | null;
  onNeedSignIn: () => void;
  onBack: () => void;
  onConfirmed: (ticket: Ticket) => void;
}) {
  const [guests, setGuests] = useState<Guest[]>(() => Array.from({ length: guestCount }, () => ({ name: '', age: '' })));
  const [accepted, setAccepted] = useState(false);
  const [booking, setBooking] = useState<CustomerBooking | null>(null);
  const [busy, setBusy] = useState<null | 'hold' | 'pay' | 'confirm'>(null);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const idem = useRef(uuid());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const total = mode === 'PRIVATE' ? slot.private_raft_price_paise ?? 0 : slot.per_seat_price_paise * guests.length;
  const guestsValid = guests.every((g) => g.name.trim().length >= 2 && ageOk(g.age, slot.min_age, slot.max_age));
  const holdLeft = booking ? Math.max(0, Math.floor((new Date(booking.hold_expires_at).getTime() - now) / 1000)) : 0;
  const expired = !!booking && booking.status === 'PENDING_PAYMENT' && holdLeft === 0;
  const locked = !!booking; // guest details are fixed once seats are held

  const setGuest = (i: number, patch: Partial<Guest>) => setGuests((all) => all.map((g, j) => (j === i ? { ...g, ...patch } : g)));

  const leave = () => {
    // Release held seats straight away instead of making others wait 10 minutes.
    if (booking?.status === 'PENDING_PAYMENT' && !expired) void api(`/bookings/${booking.id}`, { method: 'DELETE' }).catch(() => undefined);
    onBack();
  };

  const startAgain = () => {
    setBooking(null);
    setErr(null);
    setInfo(null);
    idem.current = uuid();
  };

  const confirmAndFetchTicket = async (bookingId: string) => {
    setBusy('confirm');
    for (let i = 0; i < 20; i++) {
      const b = await api<CustomerBooking>(`/bookings/${bookingId}`);
      setBooking(b);
      if (b.status === 'CONFIRMED') {
        onConfirmed(await api<Ticket>(`/payments/bookings/${bookingId}/qr`));
        return;
      }
      if (b.status !== 'PENDING_PAYMENT') {
        setErr(`Payment could not be matched to your booking (status: ${b.status}). Any amount charged is refunded automatically.`);
        return;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    setInfo('Your payment is still being confirmed by the bank. You’ll get an SMS, and the ticket will appear under My trips.');
  };

  const pay = async () => {
    if (!phone) return onNeedSignIn();
    setErr(null);
    setInfo(null);
    try {
      let b = booking;
      if (!b) {
        setBusy('hold');
        b = await api<CustomerBooking>('/bookings', {
          body: {
            slot_id: slot.id,
            mode,
            seat_count: mode === 'PRIVATE' ? 1 : guests.length,
            guests: guests.map((g) => ({ name: g.name.trim(), age: Number(g.age) })),
            safety_declaration_version: SAFETY_DECLARATION_VERSION,
            idempotency_key: idem.current,
          },
        });
        setBooking(b);
      }
      setBusy('pay');
      const order = await api<PaymentOrder>('/payments/order', { body: { booking_id: b.id } });
      const res = await openCheckout(order, { contact: phone, name: guests[0]?.name.trim() });
      setBusy('confirm');
      // Only the three signed fields: the API rejects unknown properties, and the SDK may add others.
      await api('/payments/verify', {
        body: {
          booking_id: b.id,
          razorpay_order_id: res.razorpay_order_id,
          razorpay_payment_id: res.razorpay_payment_id,
          razorpay_signature: res.razorpay_signature,
        },
      });
      await confirmAndFetchTicket(b.id);
    } catch (e) {
      if (e instanceof CheckoutError && e.kind === 'CANCELLED') setInfo(e.message);
      else if (e instanceof ApiError && e.code === 'PAYMENTS_NOT_CONFIGURED')
        setErr('Online payments are not switched on for this server yet (Razorpay keys missing). Your seats are held until the timer runs out.');
      else setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const payLabel = !phone ? 'Sign in to book' : booking ? `Pay ${inr(booking.amount_paise)}` : `Hold seats & pay ${inr(total)}`;

  return (
    <View style={ui.screen}>
      <Header title="Guests & payment" onBack={leave} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={ui.pad} keyboardShouldPersistTaps="handled">
          <Card>
            <Text style={ui.h2}>{slot.trip.title}</Text>
            <Text style={ui.meta}>
              {istTime(slot.start_time)} IST · {slot.trip.stretch.name}
            </Text>
            <Text style={ui.meta}>
              {slot.trip.vendor.display_name} · {mode === 'PRIVATE' ? 'Private raft' : 'Shared raft'}
            </Text>
          </Card>

          {booking && booking.status === 'PENDING_PAYMENT' && (
            <Banner tone={expired ? 'error' : holdLeft < 120 ? 'warn' : 'info'}>
              {expired
                ? 'Your hold expired and the seats were released. Start again to check availability.'
                : `Seats held for ${Math.floor(holdLeft / 60)}:${String(holdLeft % 60).padStart(2, '0')} · booking ${booking.display_code}`}
            </Banner>
          )}
          {err && <Banner tone="error">{err}</Banner>}
          {info && <Banner tone="info">{info}</Banner>}

          <Text style={ui.label}>Guest details</Text>
          <Text style={[ui.meta, { marginBottom: 8 }]}>
            Names and ages for everyone rafting. Allowed ages: {slot.min_age}
            {slot.max_age ? `–${slot.max_age}` : '+'}.
          </Text>
          {guests.map((g, i) => {
            const badAge = g.age !== '' && !ageOk(g.age, slot.min_age, slot.max_age);
            return (
              <View key={i} style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                <TextInput
                  style={[ui.input, { flex: 3 }]}
                  editable={!locked}
                  placeholder={i === 0 ? 'Lead guest full name' : `Guest ${i + 1} name`}
                  placeholderTextColor={c.muted}
                  autoCapitalize="words"
                  textContentType={i === 0 ? 'name' : 'none'}
                  value={g.name}
                  onChangeText={(name) => setGuest(i, { name })}
                  accessibilityLabel={`Guest ${i + 1} name`}
                />
                <TextInput
                  style={[ui.input, { flex: 1, borderColor: badAge ? c.error : c.line }]}
                  editable={!locked}
                  placeholder="Age"
                  placeholderTextColor={c.muted}
                  keyboardType="number-pad"
                  maxLength={2}
                  value={g.age}
                  onChangeText={(age) => setGuest(i, { age: age.replace(/\D/g, '') })}
                  accessibilityLabel={`Guest ${i + 1} age`}
                />
              </View>
            );
          })}
          {guests.some((g) => g.age !== '' && !ageOk(g.age, slot.min_age, slot.max_age)) && (
            <Text style={{ color: c.error, fontSize: 14 }}>
              This trip is for ages {slot.min_age}
              {slot.max_age ? `–${slot.max_age}` : '+'} only.
            </Text>
          )}

          <Text style={ui.label}>Safety declaration</Text>
          <Card>
            {DECLARATION.map((d) => (
              <Text key={d} style={[ui.meta, { color: c.text, marginBottom: 4 }]}>• {d}</Text>
            ))}
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: accepted, disabled: locked }}
              disabled={locked}
              onPress={() => setAccepted(!accepted)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, marginTop: 8 }}
            >
              <View
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 6,
                  borderWidth: 2,
                  borderColor: accepted ? c.primary : c.muted,
                  backgroundColor: accepted ? c.primary : 'transparent',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {accepted && <Text style={{ color: '#fff', fontWeight: '900' }}>✓</Text>}
              </View>
              <Text style={[ui.body, { flex: 1 }]}>I accept this declaration for every guest ({SAFETY_DECLARATION_VERSION})</Text>
            </Pressable>
          </Card>

          <Text style={ui.label}>Price</Text>
          <Card>
            {mode === 'PRIVATE' ? (
              <Row k={`Private raft (up to ${slot.raft_capacity})`} v={inr(slot.private_raft_price_paise)} />
            ) : (
              <Row k={`${inr(slot.per_seat_price_paise)} × ${guests.length} guest${guests.length === 1 ? '' : 's'}`} v={inr(total)} />
            )}
            <Row k="Taxes" v="Included" />
            <Row k="Convenience fee" v="₹0" />
            <View style={{ borderTopWidth: 1, borderTopColor: c.line, marginTop: 6, paddingTop: 6 }}>
              <Row k="Total payable now" v={inr(booking?.amount_paise ?? total)} strong />
            </View>
            <Text style={[ui.meta, { marginTop: 6 }]}>
              Pay 100% online by UPI, card, net banking or wallet. Free cancellation up to 24 hours before departure.
            </Text>
          </Card>

          {expired ? (
            <Button label="Start again" onPress={startAgain} />
          ) : (
            <Button
              label={busy === 'hold' ? 'Holding seats…' : busy === 'pay' ? 'Opening payment…' : busy === 'confirm' ? 'Confirming payment…' : payLabel}
              busy={!!busy}
              disabled={!!phone && (!guestsValid || !accepted)}
              onPress={pay}
            />
          )}
          {phone && !booking && (!guestsValid || !accepted) && (
            <Text style={[ui.meta, { textAlign: 'center', marginTop: 8 }]}>Fill in every guest and accept the declaration to continue.</Text>
          )}
          <Text style={[ui.meta, { textAlign: 'center', marginTop: 12, fontSize: 12 }]}>
            Operated by {trip.vendor.display_name}. RaftNow is the booking platform.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
