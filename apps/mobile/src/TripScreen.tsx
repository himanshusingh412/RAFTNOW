import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, NativeScrollEvent, NativeSyntheticEvent, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { api, ApiError, SlotView, TripDetail, clock, duration, inr, mediaUrl } from './api';
import { fitsParty } from './ExploreScreen';
import { Banner, Button, Card, Chip, Header, Row, Stepper, c, ui } from './ui';

export type Mode = 'SHARED' | 'PRIVATE';

/** Swipeable photo gallery (C-06), full width, with position dots and captions. */
function Gallery({ photos, title }: { photos: TripDetail['photos']; title: string }) {
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const height = Math.round(width * 0.62);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
  return (
    <View style={{ marginHorizontal: -16, marginBottom: 8 }}>
      <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={onScroll} accessibilityLabel={`${photos.length} photos of ${title}`}>
        {photos.map((p, i) => (
          <View key={p.id} style={{ width, height }}>
            <Image
              source={{ uri: mediaUrl(p.url) }}
              style={{ width, height, backgroundColor: c.card }}
              resizeMode="cover"
              accessibilityLabel={p.caption ?? `Photo ${i + 1} of ${photos.length}`}
            />
            {p.caption ? (
              <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: 'rgba(10,25,47,0.65)' }}>
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }} numberOfLines={2}>{p.caption}</Text>
              </View>
            ) : null}
          </View>
        ))}
      </ScrollView>
      {photos.length > 1 && (
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 8 }} accessible accessibilityLabel={`Photo ${index + 1} of ${photos.length}`}>
          {photos.map((p, i) => (
            <View key={p.id} style={{ width: i === index ? 16 : 6, height: 6, borderRadius: 3, backgroundColor: i === index ? c.accent : c.line }} />
          ))}
        </View>
      )}
    </View>
  );
}

export function mapsUrl(t: { meeting_point: string; meeting_lat: number | null; meeting_lng: number | null }) {
  const q = t.meeting_lat != null && t.meeting_lng != null ? `${t.meeting_lat},${t.meeting_lng}` : `${t.meeting_point}, Rishikesh`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

/** Trip detail (C-06) plus departure, booking mode and party size (J1 steps 3–4). */
export function TripScreen({
  slot: initial,
  slots,
  guests: initialGuests,
  onBack,
  onContinue,
}: {
  slot: SlotView;
  slots: SlotView[];
  guests: number;
  onBack: () => void;
  onContinue: (slot: SlotView, mode: Mode, guests: number, trip: TripDetail) => void;
}) {
  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [slot, setSlot] = useState(initial);
  const [guests, setGuests] = useState(initialGuests);
  const privateOk = slot.private_raft_price_paise != null && slot.available_private_rafts > 0 && guests <= slot.raft_capacity;
  const sharedOk = slot.available_shared_seats >= guests;
  const [mode, setMode] = useState<Mode>(sharedOk ? 'SHARED' : 'PRIVATE');

  useEffect(() => {
    api<TripDetail>(`/trips/${initial.trip_id}`)
      .then(setTrip)
      .catch((e: ApiError) => setErr(e.message));
  }, [initial.trip_id]);

  useEffect(() => {
    if (mode === 'SHARED' && !sharedOk && privateOk) setMode('PRIVATE');
    if (mode === 'PRIVATE' && !privateOk && sharedOk) setMode('SHARED');
  }, [mode, sharedOk, privateOk]);

  const total = mode === 'PRIVATE' ? slot.private_raft_price_paise ?? 0 : slot.per_seat_price_paise * guests;
  const canBook = !!trip && slot.bookable && (mode === 'SHARED' ? sharedOk : privateOk);
  const maxGuests = Math.max(slot.available_shared_seats, slot.private_raft_price_paise != null && slot.available_private_rafts > 0 ? slot.raft_capacity : 0);

  return (
    <View style={ui.screen}>
      <Header title={slot.trip.vendor.display_name} onBack={onBack} />
      <ScrollView contentContainerStyle={ui.pad}>
        {trip && trip.photos.length > 0 && <Gallery photos={trip.photos} title={trip.title} />}
        <Text style={ui.h1}>{slot.trip.title}</Text>
        <Text style={ui.meta}>
          {slot.trip.stretch.name}
          {trip ? ` · ${trip.stretch.distance_km} km · ${trip.stretch.grade}` : ''} · {duration(slot.trip.duration_minutes)}
        </Text>
        {slot.trip.vendor.licence_verified && (
          <View style={[ui.pill, { marginTop: 8 }]}>
            <Text style={ui.pillText}>✓ Licence verified by RaftNow{trip?.vendor.licence_number ? ` · ${trip.vendor.licence_number}` : ''}</Text>
          </View>
        )}
        {err && <Banner tone="error">{err}</Banner>}
        {!trip && !err && <ActivityIndicator color={c.accent} style={{ marginVertical: 16 }} />}

        <Text style={ui.label}>Departure</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {slots
            .filter((x) => fitsParty(x, 1))
            .map((x) => (
              <Chip key={x.id} label={clock(x.start_time)} sub={`${x.available_shared_seats} left`} active={x.id === slot.id} onPress={() => setSlot(x)} />
            ))}
        </ScrollView>

        <Text style={ui.label}>How do you want to raft?</Text>
        <View style={{ flexDirection: 'row' }}>
          <Chip label={`Shared · ${inr(slot.per_seat_price_paise)}/person`} active={mode === 'SHARED'} onPress={() => setMode('SHARED')} />
          {slot.private_raft_price_paise != null && (
            <Chip label={`Private raft · ${inr(slot.private_raft_price_paise)}`} active={mode === 'PRIVATE'} onPress={() => setMode('PRIVATE')} />
          )}
        </View>
        <Text style={[ui.meta, { marginTop: 6 }]}>
          {mode === 'PRIVATE'
            ? `A whole raft for your group, up to ${slot.raft_capacity} guests plus a guide.`
            : `Share a raft with other guests (up to ${slot.raft_capacity} per raft).`}
        </Text>

        <Text style={ui.label}>Guests</Text>
        <Stepper label="guests" value={guests} min={1} max={Math.max(1, Math.min(16, maxGuests))} onChange={setGuests} />
        {mode === 'SHARED' && !sharedOk && <Banner tone="warn">Only {slot.available_shared_seats} shared seats left on this departure.</Banner>}
        {mode === 'PRIVATE' && guests > slot.raft_capacity && <Banner tone="warn">A private raft holds up to {slot.raft_capacity} guests.</Banner>}

        {trip && (
          <>
            {trip.description ? (
              <Card style={{ marginTop: 16 }}>
                <Text style={ui.body}>{trip.description}</Text>
              </Card>
            ) : null}

            <Card>
              <Text style={ui.h2}>What's included</Text>
              {trip.inclusions.map((i) => (
                <Text key={i} style={ui.body}>✓ {i}</Text>
              ))}
              {trip.exclusions.length > 0 && (
                <>
                  <Text style={[ui.h2, { marginTop: 12 }]}>Not included</Text>
                  {trip.exclusions.map((i) => (
                    <Text key={i} style={ui.meta}>– {i}</Text>
                  ))}
                </>
              )}
            </Card>

            <Card>
              <Text style={ui.h2}>Meeting point</Text>
              <Text style={ui.body}>{trip.meeting_point}</Text>
              <Text style={ui.meta}>Report 30 minutes before {clock(slot.start_time)}. Put-in: {trip.stretch.put_in_point}.</Text>
              <Button tone="ghost" label="Open in Google Maps" onPress={() => void Linking.openURL(mapsUrl(trip))} />
            </Card>

            <Card>
              <Text style={ui.h2}>Safety rules</Text>
              <Text style={ui.body}>
                Age {trip.min_age}
                {trip.max_age ? `–${trip.max_age}` : '+'} only. Helmets and life jackets are mandatory and provided. Not suitable for guests who are pregnant or
                have heart, back or seizure conditions. No alcohol before the trip.
              </Text>
            </Card>

            <Card>
              <Text style={ui.h2}>Cancellation policy</Text>
              {trip.cancellation_policy.map((p) => (
                <Row key={p.window} k={p.window} v={`${p.refund_percent}%`} />
              ))}
            </Card>

            <Card>
              <Text style={ui.h2}>Operator</Text>
              <Text style={ui.body}>{trip.vendor.display_name}</Text>
              {trip.vendor.address ? <Text style={ui.meta}>{trip.vendor.address}</Text> : null}
              <Button tone="ghost" label={`Call ${trip.vendor.phone}`} onPress={() => void Linking.openURL(`tel:${trip.vendor.phone}`)} />
            </Card>
          </>
        )}
      </ScrollView>

      <View style={{ paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 16, backgroundColor: c.card, borderTopWidth: 1, borderTopColor: c.line }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.text, fontSize: 22, fontWeight: '900' }}>{inr(total)}</Text>
          <Text style={[ui.meta, { fontSize: 12 }]}>{mode === 'PRIVATE' ? 'Private raft' : `${guests} × ${inr(slot.per_seat_price_paise)}`} · taxes incl.</Text>
        </View>
        <Button label="Book now" disabled={!canBook} onPress={() => trip && onContinue(slot, mode, guests, trip)} style={{ marginTop: 0, flex: 1 }} />
      </View>
    </View>
  );
}
