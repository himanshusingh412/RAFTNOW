import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { api, ApiError, Availability, SlotView, Stretch, addDays, clock, duration, inr, istDay, mediaUrl, todayIst } from './api';
import { Banner, Chip, Stepper, c, ui } from './ui';

const WINDOW_DAYS = 60; // C-03: today to +60 days
const MAX_GUESTS = 16;

type Sort = 'TIME' | 'PRICE';

function dayChip(date: string, today: string) {
  if (date === today) return { label: 'Today', sub: '' };
  if (date === addDays(today, 1)) return { label: 'Tomorrow', sub: '' };
  const d = new Date(`${date}T00:00:00Z`);
  return {
    label: d.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' }),
    sub: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
  };
}

/** "1 Jul – 15 Sep": a closure's first and last day (its end instant is exclusive). */
function closureDays(from: string, until: string | null) {
  return until ? `${istDay(from)} – ${istDay(new Date(Date.parse(until) - 1).toISOString())}` : `from ${istDay(from)}`;
}

/** Fits the party: enough shared seats, or a whole private raft that holds everyone. */
export function fitsParty(slot: SlotView, guests: number) {
  if (!slot.bookable) return false;
  if (slot.available_shared_seats >= guests) return true;
  return slot.private_raft_price_paise != null && slot.available_private_rafts > 0 && guests <= slot.raft_capacity;
}

/**
 * Home / search (J1 steps 1–2): date, stretch (or any) and party size, then
 * live departures sorted by time or price. Works signed out (C-02).
 */
export function ExploreScreen({
  onOpen,
}: {
  onOpen: (slot: SlotView, guests: number, sameTripSlots: SlotView[]) => void;
}) {
  const today = todayIst();
  const dates = useMemo(() => Array.from({ length: WINDOW_DAYS + 1 }, (_, i) => addDays(today, i)), [today]);
  const [date, setDate] = useState(today);
  const [stretchId, setStretchId] = useState<string | null>(null);
  const [guests, setGuests] = useState(2);
  const [sort, setSort] = useState<Sort>('TIME');
  const [privateOnly, setPrivateOnly] = useState(false);
  const [stretches, setStretches] = useState<Stretch[] | null>(null);
  const [data, setData] = useState<Availability | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<Stretch[]>('/stretches')
      .then(setStretches)
      .catch((e: ApiError) => setErr(e.message));
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setErr(null);
    const q = `date=${date}${stretchId ? `&stretch_id=${stretchId}` : ''}`;
    api<Availability>(`/slots?${q}`)
      .then(setData)
      .catch((e: ApiError) => {
        setData(null);
        setErr(e.message);
      })
      .finally(() => setLoading(false));
  }, [date, stretchId]);
  useEffect(load, [load]);

  const results = useMemo(() => {
    const list = (data?.slots ?? []).filter(
      (s) => fitsParty(s, guests) && (!privateOnly || (s.private_raft_price_paise != null && s.available_private_rafts > 0)),
    );
    return [...list].sort((a, b) =>
      sort === 'PRICE' ? a.per_seat_price_paise - b.per_seat_price_paise || a.start_time.localeCompare(b.start_time) : a.start_time.localeCompare(b.start_time),
    );
  }, [data, guests, sort, privateOnly]);
  const hiddenFull = (data?.slots.length ?? 0) - results.length;
  const selectedStretch = stretches?.find((s) => s.id === stretchId);
  // Upcoming planned closure to warn about: the selected stretch's, or (for "Any") a river-wide one.
  const upcoming = selectedStretch
    ? selectedStretch.next_closure
    : stretches?.map((s) => s.next_closure).find((c) => c?.river_wide) ?? null;
  const allClosed = !!data && data.slots.length > 0 && data.slots.every((s) => s.closure_reason);

  const header = (
    <View>
      <Text style={ui.h1}>Raft the Ganga</Text>
      <Text style={ui.meta}>Licensed Rishikesh operators · instant confirmation</Text>

      <Text style={ui.label}>Date</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {dates.map((d) => {
          const l = dayChip(d, today);
          return <Chip key={d} label={l.label} sub={l.sub} active={d === date} onPress={() => setDate(d)} />;
        })}
      </ScrollView>

      <Text style={ui.label}>Stretch</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Chip label="Any stretch" active={stretchId === null} onPress={() => setStretchId(null)} />
        {stretches?.map((s) => (
          <Chip
            key={s.id}
            label={s.name.replace(' → Rishikesh', '')}
            sub={s.status === 'CLOSED' ? 'Closed' : `${s.distance_km} km · ${s.grade.replace(/^Grade\s*/i, '')}`}
            active={s.id === stretchId}
            onPress={() => setStretchId(s.id)}
          />
        ))}
      </ScrollView>
      {selectedStretch?.closure && (
        <Banner tone="warn">
          River closed{selectedStretch.closure.until ? ` until ${istDay(new Date(Date.parse(selectedStretch.closure.until) - 1).toISOString())}` : ''}: {selectedStretch.closure.reason}
        </Banner>
      )}
      {upcoming && !selectedStretch?.closure && (
        <Banner tone="info">
          {upcoming.river_wide ? 'River' : selectedStretch?.name.replace(' → Rishikesh', '')} closed {closureDays(upcoming.from, upcoming.until)}: {upcoming.reason}
        </Banner>
      )}

      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <View>
          <Text style={ui.label}>Guests</Text>
          <Stepper label="guests" value={guests} min={1} max={MAX_GUESTS} onChange={setGuests} />
        </View>
        <View style={{ flexDirection: 'row' }}>
          <Chip label={sort === 'TIME' ? 'Earliest' : 'Cheapest'} active={false} onPress={() => setSort(sort === 'TIME' ? 'PRICE' : 'TIME')} />
          <Chip label="Private" active={privateOnly} onPress={() => setPrivateOnly(!privateOnly)} />
        </View>
      </View>

      {err && <Banner tone="error">{err}</Banner>}
      {allClosed && <Banner tone="warn">No rafting on this day: {data!.slots[0].closure_reason}. Pick another date.</Banner>}
      <Text style={[ui.label, { marginTop: 20 }]}>
        {loading ? 'Checking live seats…' : `${results.length} departure${results.length === 1 ? '' : 's'}`}
      </Text>
    </View>
  );

  return (
    <FlatList
      style={ui.screen}
      contentContainerStyle={ui.pad}
      data={results}
      keyExtractor={(s) => s.id}
      ListHeaderComponent={header}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={c.aqua} />}
      ListEmptyComponent={
        loading ? (
          <ActivityIndicator color={c.aqua} style={{ marginTop: 24 }} />
        ) : !err ? (
          <View style={ui.card}>
            <Text style={ui.body}>No departures fit {guests} guest{guests === 1 ? '' : 's'} on this date.</Text>
            <Text style={[ui.meta, { marginTop: 4 }]}>
              {hiddenFull > 0 ? `${hiddenFull} more ${hiddenFull === 1 ? 'is' : 'are'} full or closed. ` : ''}Try another date or stretch.
            </Text>
          </View>
        ) : null
      }
      ListFooterComponent={data && results.length > 0 ? <Text style={[ui.meta, { marginTop: 8, fontSize: 12 }]}>{data.note}</Text> : null}
      renderItem={({ item: s }) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${clock(s.start_time)}, ${s.trip.stretch.name}, ${s.trip.vendor.display_name}, ${inr(s.per_seat_price_paise)} per person, ${s.available_shared_seats} seats left`}
          onPress={() => onOpen(s, guests, (data?.slots ?? []).filter((x) => x.trip_id === s.trip_id))}
          style={({ pressed }) => [ui.card, pressed && { borderColor: c.teal }]}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            {s.trip.cover_photo_url ? (
              <Image
                source={{ uri: mediaUrl(s.trip.cover_photo_url) }}
                style={{ width: 64, height: 64, borderRadius: 10, marginRight: 12, backgroundColor: c.line }}
                accessibilityIgnoresInvertColors
                accessible={false}
              />
            ) : null}
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={{ color: '#fff', fontSize: 20, fontWeight: '900' }}>{clock(s.start_time)}</Text>
              <Text style={[ui.body, { fontWeight: '700', marginTop: 2 }]} numberOfLines={1}>{s.trip.stretch.name.replace(' → Rishikesh', '')}</Text>
              <Text style={ui.meta} numberOfLines={1}>
                {s.trip.vendor.display_name}
              </Text>
              {s.trip.vendor.licence_verified && <Text style={ui.badgeOk}>✓ Licensed</Text>}
              <Text style={ui.meta}>{duration(s.trip.duration_minutes)} · age {s.min_age}{s.max_age ? `–${s.max_age}` : '+'}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ color: c.aqua, fontSize: 20, fontWeight: '900' }}>{inr(s.per_seat_price_paise)}</Text>
              <Text style={ui.meta}>per person</Text>
              <Text style={[ui.meta, { color: s.available_shared_seats <= 4 ? c.warn : c.muted, marginTop: 6 }]}>
                {s.available_shared_seats} seat{s.available_shared_seats === 1 ? '' : 's'} left
              </Text>
              {s.private_raft_price_paise != null && s.available_private_rafts > 0 && (
                <Text style={ui.meta}>Private {inr(s.private_raft_price_paise)}</Text>
              )}
            </View>
          </View>
        </Pressable>
      )}
    />
  );
}
