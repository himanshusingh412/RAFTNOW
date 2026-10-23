import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { configureAuth, SlotView, Ticket, TripDetail } from './src/api';
import { endSession, restoreSession, StoredSession, tokenProviderFor } from './src/session';
import { LoginScreen } from './src/LoginScreen';
import { ExploreScreen } from './src/ExploreScreen';
import { Mode, TripScreen } from './src/TripScreen';
import { CheckoutScreen } from './src/CheckoutScreen';
import { MyTripsScreen } from './src/MyTripsScreen';
import { TicketView } from './src/TicketView';
import { AccountScreen } from './src/AccountScreen';
import { OperatorScreen } from './src/OperatorScreen';
import { clearOffline } from './src/offline';
import { Button, GradientFill, HeroHeader, Icon, IconName, c, ui } from './src/ui';

type Tab = 'explore' | 'trips' | 'scan' | 'account';
type AuthState = { status: 'restoring' } | { status: 'ready'; session: StoredSession | null };
type Flow =
  | { screen: 'search' }
  | { screen: 'trip'; slot: SlotView; slots: SlotView[]; guests: number }
  | { screen: 'checkout'; slot: SlotView; slots: SlotView[]; trip: TripDetail; mode: Mode; guests: number };

const EXPIRED = 'Your session has expired. Please sign in again.';

/**
 * Customers browse and pick a trip without signing in (C-02); sign-in opens
 * as a sheet at checkout or under My trips. Operators (active vendor staff)
 * also get the QR scanner. The API enforces every rule; the app only routes.
 */
export default function App() {
  // Only the five weights the sign-in screen uses are bundled (Sora + Inter, SIL Open Font License).
  const [fontsLoaded, fontError] = useFonts({
    Sora_700Bold: require('@expo-google-fonts/sora/700Bold/Sora_700Bold.ttf'),
    Sora_800ExtraBold: require('@expo-google-fonts/sora/800ExtraBold/Sora_800ExtraBold.ttf'),
    Inter_400Regular: require('@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf'),
    Inter_500Medium: require('@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf'),
    Inter_600SemiBold: require('@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf'),
  });
  const [auth, setAuth] = useState<AuthState>({ status: 'restoring' });
  const [tab, setTab] = useState<Tab>('explore');
  const [flow, setFlow] = useState<Flow>({ screen: 'search' });
  const [ticket, setTicket] = useState<{ ticket: Ticket; justBooked?: boolean; offline?: boolean } | null>(null);
  const [login, setLogin] = useState<{ notice: string | null } | null>(null);
  const ending = useRef(false);

  const signOut = useCallback(async (notice: string | null) => {
    if (ending.current) return;
    ending.current = true;
    configureAuth(null, null);
    await endSession();
    clearOffline();
    setTicket(null);
    setFlow({ screen: 'search' }); // never leave a previous account's checkout on screen
    setTab('explore');
    setAuth({ status: 'ready', session: null });
    if (notice) setLogin({ notice });
  }, []);

  const startSession = useCallback(
    (session: StoredSession, fresh: boolean) => {
      ending.current = false;
      // Any API call whose token is rejected (expired/revoked) ends the session.
      configureAuth(tokenProviderFor(session), () => void signOut(EXPIRED));
      if (session.role === 'operator' && !fresh) setTab('scan');
      setAuth({ status: 'ready', session });
    },
    [signOut],
  );

  useEffect(() => {
    restoreSession()
      .then(({ session, expired }) => {
        if (session) startSession(session, false);
        else setAuth({ status: 'ready', session: null });
        if (expired) setLogin({ notice: EXPIRED });
      })
      .catch(() => setAuth({ status: 'ready', session: null }));
  }, [startSession]);

  if (!(fontsLoaded || fontError) || auth.status === 'restoring') {
    return (
      <SafeAreaProvider>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel="Loading RaftNow">
          <StatusBar style="light" />
          <GradientFill from={c.heroFrom} to={c.heroTo} vertical />
          <Icon name="waves" size={56} color="#ffffff" strokeWidth={2.2} />
          <Text style={{ color: '#ffffff', fontSize: 30, fontWeight: '900', marginTop: 12, letterSpacing: -0.5 }}>
            Raft<Text style={{ color: c.primaryLight }}>Now</Text>
          </Text>
          <ActivityIndicator color="#ffffff" style={{ marginTop: 24 }} />
        </View>
      </SafeAreaProvider>
    );
  }

  const session = auth.session;
  const isOperator = session?.role === 'operator';
  const tabs: Array<{ id: Tab; label: string; icon: IconName }> = [
    { id: 'explore', label: 'Explore', icon: 'search' },
    { id: 'trips', label: 'My trips', icon: 'ticket' },
    ...(isOperator ? [{ id: 'scan' as Tab, label: 'Check-in', icon: 'scan' as IconName }] : []),
    { id: 'account', label: 'Account', icon: 'user' },
  ];

  const confirmSignOut = () =>
    Alert.alert('Sign out of RaftNow?', session?.phone ? `You’re signed in as ${session.phone}.` : undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut(null) },
    ]);

  return (
    <SafeAreaProvider>
      {/* No top edge: each screen draws its own header under the status bar. */}
      <SafeAreaView style={ui.screen} edges={['left', 'right']}>
        <View style={{ flex: 1 }}>
          {ticket ? (
            <TicketView {...ticket} onClose={() => setTicket(null)} />
          ) : (
            <>
              {/* Explore stays mounted so date/stretch/guest choices survive the trip and checkout screens. */}
              <View style={{ flex: 1, display: tab === 'explore' && flow.screen === 'search' ? 'flex' : 'none' }}>
                <ExploreScreen onOpen={(slot, guests, slots) => setFlow({ screen: 'trip', slot, slots, guests })} />
              </View>
              {tab === 'explore' && flow.screen === 'trip' && (
                <TripScreen
                  slot={flow.slot}
                  slots={flow.slots}
                  guests={flow.guests}
                  onBack={() => setFlow({ screen: 'search' })}
                  onContinue={(slot, mode, guests, trip) => setFlow({ screen: 'checkout', slot, slots: flow.slots, trip, mode, guests })}
                />
              )}
              {tab === 'explore' && flow.screen === 'checkout' && (
                <CheckoutScreen
                  slot={flow.slot}
                  trip={flow.trip}
                  mode={flow.mode}
                  guestCount={flow.guests}
                  phone={session?.phone ?? null}
                  onNeedSignIn={() => setLogin({ notice: 'Sign in with your phone number to book. Your choices are kept.' })}
                  onBack={() => setFlow({ screen: 'trip', slot: flow.slot, slots: flow.slots, guests: flow.guests })}
                  onConfirmed={(t) => {
                    setFlow({ screen: 'search' });
                    setTab('trips');
                    setTicket({ ticket: t, justBooked: true });
                  }}
                />
              )}
              {tab === 'trips' &&
                (session ? (
                  <MyTripsScreen phone={session.phone} onTicket={(t, offline) => setTicket({ ticket: t, offline })} onExplore={() => setTab('explore')} />
                ) : (
                  <View style={{ flex: 1 }}>
                    <HeroHeader title="My Trips" subtitle="Bookings and e-tickets" />
                    <View style={[ui.card, { margin: 16, alignItems: 'center', paddingVertical: 28 }]}>
                      <Icon name="ticket" size={40} color={c.primary} strokeWidth={1.6} />
                      <Text style={[ui.h2, { marginTop: 12, marginBottom: 4 }]}>Your trips live here</Text>
                      <Text style={[ui.meta, { textAlign: 'center' }]}>Log in with your mobile number to see your bookings and tickets.</Text>
                      <Button label="Login" onPress={() => setLogin({ notice: null })} style={{ alignSelf: 'stretch', marginTop: 16 }} />
                    </View>
                  </View>
                ))}
              {tab === 'scan' && isOperator && <OperatorScreen />}
              {tab === 'account' && (
                <AccountScreen
                  phone={session?.phone ?? null}
                  isOperator={isOperator}
                  onSignOut={confirmSignOut}
                  onDeleted={() => void signOut('Your account has been deleted.')}
                />
              )}
            </>
          )}
        </View>

        {!ticket && (
          <SafeAreaView
            edges={['bottom']}
            style={{ flexDirection: 'row', backgroundColor: c.card, borderTopWidth: 1, borderTopColor: c.line, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: -2 }, elevation: 8 }}
          >
            {tabs.map((t) => (
              <Pressable
                key={t.id}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === t.id }}
                onPress={() => {
                  if (t.id === 'explore' && tab === 'explore') setFlow({ screen: 'search' });
                  setTab(t.id);
                }}
                style={{ flex: 1, minHeight: 58, alignItems: 'center', justifyContent: 'center', paddingTop: 6 }}
              >
                <Icon name={t.icon} size={22} color={tab === t.id ? c.primary : c.muted} strokeWidth={tab === t.id ? 2.4 : 2} />
                <Text style={{ color: tab === t.id ? c.primary : c.muted, fontWeight: tab === t.id ? '800' : '600', fontSize: 12, marginTop: 3 }}>{t.label}</Text>
              </Pressable>
            ))}
          </SafeAreaView>
        )}
      </SafeAreaView>

      <Modal visible={!!login} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setLogin(null)}>
        <SafeAreaProvider>
          {login && (
            <LoginScreen
              notice={login.notice}
              onSignedIn={(s) => {
                setLogin(null);
                startSession(s, true);
              }}
            />
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close sign-in"
            hitSlop={12}
            onPress={() => setLogin(null)}
            style={{ position: 'absolute', top: 16, right: 16, minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ color: '#ffffff', fontSize: 16, fontWeight: '700' }}>Close</Text>
          </Pressable>
        </SafeAreaProvider>
      </Modal>
    </SafeAreaProvider>
  );
}
