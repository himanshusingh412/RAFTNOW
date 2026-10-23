import React, { useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { api, ApiError } from './api';
import { clearOffline } from './offline';
import { Banner, Button, Card, HeroHeader, c, ui } from './ui';

/** Support line in E.164 without "+", e.g. 919876543210. Set per build: EXPO_PUBLIC_SUPPORT_PHONE. */
const SUPPORT_PHONE = process.env.EXPO_PUBLIC_SUPPORT_PHONE?.replace(/\D/g, '') || null;

const FAQ: Array<[string, string]> = [
  ['When do I get my ticket?', 'Right after payment. It’s in My trips, and we also send it by SMS and email. Tickets open offline.'],
  ['Where do I report?', 'At the meeting point on your ticket, 30 minutes before departure. Tap “Open in Google Maps” for directions.'],
  ['What if the river is closed?', 'If the authorities or RaftNow close the river, your booking is cancelled and refunded in full automatically.'],
  ['How do refunds work?', 'More than 24 hours before departure: 100%. 6–24 hours: 50%. Under 6 hours or no-show: no refund. Refunds reach your original payment method in 5–7 working days.'],
  ['Do I pay anything at the river?', 'No. You pay the full price in the app. Operators may not ask for extra money, except any government fee listed as not included.'],
  ['What should I bring?', 'Quick-dry clothes, a spare set to change into, sandals with straps, sunscreen and photo ID. Leave valuables in your hotel.'],
];

export function AccountScreen({ phone, isOperator, onSignOut, onDeleted }: { phone: string | null; isOperator: boolean; onSignOut: () => void; onDeleted: () => void }) {
  const [open, setOpen] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const deleteAccount = () =>
    Alert.alert(
      'Delete your RaftNow account?',
      'Your name, email and sign-in are erased. Past bookings are kept only as legal and tax records. This can’t be undone.',
      [
        { text: 'Keep account', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            setErr(null);
            try {
              await api('/me', { method: 'DELETE' });
              clearOffline();
              onDeleted();
            } catch (e) {
              setErr(e instanceof ApiError ? e.message : 'Could not delete your account. Try again.');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );

  return (
    <ScrollView style={ui.screen} contentContainerStyle={{ paddingBottom: 32 }}>
      <HeroHeader title={phone ? 'Hi there!' : 'My Account'} subtitle={phone ? phone : 'Log in to book and manage trips'} />
      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
      {err && <Banner tone="error">{err}</Banner>}
      {phone ? (
        <Card>
          <Text style={ui.meta}>Signed in as</Text>
          <Text style={[ui.body, { fontWeight: '800' }]}>{phone}</Text>
          {isOperator && <Text style={ui.meta}>Operator staff</Text>}
          <Button tone="ghost" label="Sign out" onPress={onSignOut} />
        </Card>
      ) : (
        <Card>
          <Text style={ui.body}>You can browse without an account. We’ll ask for your phone number when you book.</Text>
        </Card>
      )}

      <Text style={ui.label}>Help</Text>
      <Card>
        {SUPPORT_PHONE ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button style={{ flex: 1 }} tone="ghost" label="Call support" onPress={() => void Linking.openURL(`tel:+${SUPPORT_PHONE}`)} />
            <Button
              style={{ flex: 1 }}
              tone="ghost"
              label="WhatsApp"
              onPress={() => void Linking.openURL(`https://wa.me/${SUPPORT_PHONE}?text=${encodeURIComponent('Hi RaftNow, I need help with my booking')}`)}
            />
          </View>
        ) : (
          <Text style={ui.meta}>Support contact isn’t configured in this build (EXPO_PUBLIC_SUPPORT_PHONE).</Text>
        )}
      </Card>

      <Text style={ui.label}>FAQ</Text>
      <Card style={{ paddingVertical: 4 }}>
        {FAQ.map(([q, a], i) => (
          <Pressable
            key={q}
            accessibilityRole="button"
            accessibilityState={{ expanded: open === i }}
            onPress={() => setOpen(open === i ? null : i)}
            style={{ paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderTopColor: c.line, minHeight: 44 }}
          >
            <Text style={[ui.body, { fontWeight: '700' }]}>
              {open === i ? '−' : '+'} {q}
            </Text>
            {open === i && <Text style={[ui.meta, { marginTop: 6, color: c.text }]}>{a}</Text>}
          </Pressable>
        ))}
      </Card>

      {phone && !isOperator && (
        <>
          <Text style={ui.label}>Privacy</Text>
          <Card>
            <Text style={ui.meta}>Delete your account and personal data (Digital Personal Data Protection Act, 2023).</Text>
            <Button tone="danger" label="Delete my account" busy={busy} onPress={deleteAccount} />
          </Card>
        </>
      )}
      </View>
    </ScrollView>
  );
}
