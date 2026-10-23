import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { api, ApiError, CancelQuote, CustomerBooking, Ticket, inr, istTime, statusLabel } from './api';
import { loadOffline, saveBookings, saveTicket } from './offline';
import { Banner, Button, Card, c, ui } from './ui';

const LIVE = ['CONFIRMED', 'CHECKED_IN'];

/**
 * My trips (C-15, C-16): upcoming and past bookings with refund status, the
 * QR ticket and cancellation with a refund preview. Falls back to the copy
 * saved on the phone when there is no network.
 */
export function MyTripsScreen({ phone, onTicket, onExplore }: { phone: string; onTicket: (t: Ticket, offline: boolean) => void; onExplore: () => void }) {
  const [bookings, setBookings] = useState<CustomerBooking[] | null>(null);
  const [offlineAt, setOfflineAt] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ id: string; kind: 'ticket' | 'cancel' } | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const list = (await api<CustomerBooking[]>('/bookings')).filter((b) => b.status !== 'EXPIRED');
      setBookings(list);
      setOfflineAt(null);
      await saveBookings(phone, list);
      // Pre-save tickets for upcoming trips so they open at the river without signal.
      const upcoming = list.filter((b) => LIVE.includes(b.status) && b.slot && new Date(b.slot.start_time).getTime() > Date.now() - 6 * 3600_000);
      for (const b of upcoming) {
        api<Ticket>(`/payments/bookings/${b.id}/qr`)
          .then((t) => saveTicket(phone, t))
          .catch(() => undefined);
      }
    } catch (e) {
      const cached = await loadOffline(phone);
      if (e instanceof ApiError && e.status === 0 && cached) {
        setBookings(cached.bookings);
        setOfflineAt(cached.saved_at);
      } else setErr((e as Error).message);
    }
  }, [phone]);
  useEffect(() => void load(), [load]);

  const openTicket = async (b: CustomerBooking) => {
    setBusy({ id: b.id, kind: 'ticket' });
    try {
      const t = await api<Ticket>(`/payments/bookings/${b.id}/qr`);
      await saveTicket(phone, t);
      onTicket(t, false);
    } catch (e) {
      const cached = (await loadOffline(phone))?.tickets[b.id];
      if (cached) onTicket(cached, true);
      else setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const cancel = async (b: CustomerBooking) => {
    setBusy({ id: b.id, kind: 'cancel' });
    try {
      const q = await api<CancelQuote>(`/me/bookings/${b.id}/cancel-quote`);
      if (!q.cancellable) {
        Alert.alert('Can’t cancel this booking', q.reason ?? undefined);
        return;
      }
      const body = q.unpaid
        ? 'You haven’t paid yet. Cancelling releases the held seats.'
        : `You’ll get ${inr(q.refund_paise)} back (${q.refund_percent}% of ${inr(q.amount_paise)}) to your original payment method within 5–7 working days.`;
      Alert.alert(`Cancel ${b.display_code}?`, body, [
        { text: 'Keep booking', style: 'cancel' },
        {
          text: 'Cancel booking',
          style: 'destructive',
          onPress: async () => {
            setBusy({ id: b.id, kind: 'cancel' });
            try {
              const r = await api<{ refund_paise: number }>(`/bookings/${b.id}`, { method: 'DELETE' });
              Alert.alert('Booking cancelled', r.refund_paise > 0 ? `Refund of ${inr(r.refund_paise)} initiated. It takes 5–7 working days to reach you.` : undefined);
              await load();
            } catch (e) {
              setErr((e as Error).message);
            } finally {
              setBusy(null);
            }
          },
        },
      ]);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const now = Date.now();
  const upcoming = (bookings ?? []).filter((b) => b.slot && new Date(b.slot.end_time ?? b.slot.start_time).getTime() >= now && !b.status.startsWith('CANCELLED'));
  const past = (bookings ?? []).filter((b) => !upcoming.includes(b));

  const item = (b: CustomerBooking) => (
    <Card key={b.id}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: c.aqua, fontWeight: '900', fontSize: 18, letterSpacing: 2 }}>{b.display_code}</Text>
        <View style={ui.pill}>
          <Text style={ui.pillText}>{statusLabel(b.status)}</Text>
        </View>
      </View>
      {b.slot && <Text style={[ui.body, { fontWeight: '700', marginTop: 6 }]}>{b.slot.trip.title}</Text>}
      {b.slot && <Text style={ui.meta}>{istTime(b.slot.start_time)} IST · {b.slot.trip.vendor.display_name}</Text>}
      <Text style={ui.meta}>
        {b.mode === 'PRIVATE' ? `Private raft · ${b.seat_count} guests` : `${b.seat_count} seat${b.seat_count === 1 ? '' : 's'}`} · {inr(b.amount_paise)}
      </Text>
      {b.refunds?.map((r) => (
        <Text key={r.id} style={[ui.meta, { color: r.status === 'FAILED' ? c.error : c.ok }]}>
          Refund {inr(r.amount_paise)} · {r.status === 'PROCESSED' ? 'sent to your account' : r.status === 'FAILED' ? 'failed — our team will contact you' : 'initiated, 5–7 working days'}
        </Text>
      ))}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {LIVE.includes(b.status) && <Button style={{ flex: 1 }} label="Show ticket" busy={busy?.id === b.id && busy.kind === 'ticket'} disabled={busy?.id === b.id} onPress={() => void openTicket(b)} />}
        {(b.status === 'CONFIRMED' || b.status === 'PENDING_PAYMENT') && !offlineAt && (
          <Button style={{ flex: 1 }} tone="danger" label="Cancel" busy={busy?.id === b.id && busy.kind === 'cancel'} disabled={busy?.id === b.id} onPress={() => void cancel(b)} />
        )}
      </View>
    </Card>
  );

  return (
    <ScrollView style={ui.screen} contentContainerStyle={ui.pad} refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={c.aqua} />}>
      <Text style={ui.h1}>My trips</Text>
      {offlineAt && <Banner tone="warn">No connection. Showing trips saved at {istTime(offlineAt)}.</Banner>}
      {err && <Banner tone="error">{err}</Banner>}
      {!bookings && !err && <Text style={ui.meta}>Loading…</Text>}
      {bookings?.length === 0 && (
        <Card>
          <Text style={ui.body}>No trips yet.</Text>
          <Button label="Find a rafting trip" onPress={onExplore} />
        </Card>
      )}
      {upcoming.length > 0 && <Text style={ui.label}>Upcoming</Text>}
      {upcoming.map(item)}
      {past.length > 0 && <Text style={ui.label}>Past & cancelled</Text>}
      {past.map(item)}
      <Pressable onPress={load} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }}>
        <Text style={[ui.meta, { textAlign: 'center' }]}>Pull down or tap to refresh</Text>
      </Pressable>
    </ScrollView>
  );
}
