import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { api, ApiError, CheckInResult, ManifestRow, istTime, todayIst } from './api';
import { s } from './styles';

/**
 * Operator QR check-in with the device camera (expo-camera CameraView barcode
 * scanning), or by typing the booking code when the customer can't show the
 * QR (dead phone, no signal). Both go to POST /bookings/check-in; the server
 * verifies the signature or code, vendor ownership, status, check-in window
 * and duplicates. The app never decides validity locally.
 */
export function OperatorScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; title: string; detail: string } | null>(null);
  const [manifest, setManifest] = useState<ManifestRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const last = useRef<{ token: string; at: number } | null>(null);

  const loadManifest = useCallback(() => {
    api<ManifestRow[]>(`/vendor/bookings?date=${todayIst()}`)
      .then(setManifest)
      .catch((e: ApiError) => setErr(e.message));
  }, []);
  useEffect(loadManifest, [loadManifest]);

  const checkIn = async (body: { qr_token: string } | { booking_code: string }) => {
    setBusy(true);
    try {
      const r = await api<CheckInResult>('/bookings/check-in', { body });
      setResult({
        ok: true,
        title: `Checked in ${r.booking.display_code}`,
        detail: `${r.booking.seat_count} pax — ${r.booking.guests.map((g) => g.name).join(', ')}\n${r.booking.trip_title} · ${istTime(r.booking.start_time)}`,
      });
      loadManifest();
      return true;
    } catch (e) {
      const ae = e as ApiError;
      setResult({ ok: false, title: (ae.code ?? 'ERROR').replace(/_/g, ' '), detail: ae.message });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const onScanned = async ({ data }: { data: string }) => {
    if (busy) return;
    if (last.current && last.current.token === data && Date.now() - last.current.at < 4000) return;
    last.current = { token: data, at: Date.now() };
    await checkIn({ qr_token: data });
  };

  const onCode = async () => {
    if (code.replace(/[^A-Za-z0-9]/g, '').length < 6 || busy) return;
    if (await checkIn({ booking_code: code })) setCode('');
  };

  return (
    <ScrollView style={s.content}>
      <View style={s.card}>
        <Text style={s.cardTitle}>Scan customer ticket</Text>
        {!permission?.granted ? (
          <>
            <Text style={s.meta}>Camera access is needed to scan QR tickets.</Text>
            <TouchableOpacity style={s.button} onPress={requestPermission}>
              <Text style={s.buttonText}>Allow camera</Text>
            </TouchableOpacity>
          </>
        ) : scanning ? (
          <>
            <View style={s.scanner}>
              <CameraView
                style={{ flex: 1 }}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={busy ? undefined : onScanned}
              />
            </View>
            <TouchableOpacity style={s.buttonGhost} onPress={() => setScanning(false)}>
              <Text style={s.buttonGhostText}>Stop scanning</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity style={s.button} onPress={() => setScanning(true)}>
            <Text style={s.buttonText}>Start scanner</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={s.card}>
        <Text style={s.cardTitle}>No QR? Enter the booking code</Text>
        <Text style={s.meta}>It's on the customer's SMS and email, e.g. RF7K2M9P.</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          <TextInput
            style={[s.input, { flex: 1, fontSize: 18, letterSpacing: 2, minHeight: 48 }]}
            value={code}
            onChangeText={(t) => setCode(t.toUpperCase())}
            placeholder="RF······"
            placeholderTextColor="#8892b0"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={12}
            returnKeyType="done"
            onSubmitEditing={onCode}
            accessibilityLabel="Booking code"
          />
          <TouchableOpacity
            style={[s.button, { marginTop: 0, paddingHorizontal: 18, justifyContent: 'center', opacity: busy ? 0.6 : 1 }]}
            onPress={onCode}
            disabled={busy}
            accessibilityRole="button"
          >
            <Text style={s.buttonText}>Check in</Text>
          </TouchableOpacity>
        </View>
      </View>

      {result && (
        <View style={[s.card, { borderColor: result.ok ? '#10b981' : '#f43f5e' }]}>
          <Text style={result.ok ? s.ok : s.error}>{result.title}</Text>
          <Text style={s.meta}>{result.detail}</Text>
        </View>
      )}

      <View style={s.card}>
        <View style={s.row}>
          <Text style={s.cardTitle}>Today's manifest</Text>
          <TouchableOpacity onPress={loadManifest}>
            <Text style={s.badge}>Refresh</Text>
          </TouchableOpacity>
        </View>
        {err && <Text style={s.error}>{err}</Text>}
        {manifest?.length === 0 && <Text style={s.meta}>No bookings today.</Text>}
        {manifest?.map((m) => (
          <View key={m.id} style={{ paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#233554' }}>
            <View style={s.row}>
              <Text style={{ color: '#64ffda', fontWeight: '800' }}>{m.display_code}</Text>
              <Text style={s.badge}>{m.status.replace(/_/g, ' ')}</Text>
            </View>
            <Text style={s.meta}>
              {istTime(m.slot.start_time)} · {m.contact_name} · {m.seat_count} pax
            </Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
