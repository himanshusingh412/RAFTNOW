import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  useWindowDimensions,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import { API_URL, api, ApiError, Health } from './api';
import { Button, GradientFill, Icon, c } from './ui';
import { firebaseAuth, firebaseSignOut, idToken, onFirebaseUser, phoneAuthErrorMessage, sendSmsCode } from './phone-auth';
import type { ConfirmationResult, FirebaseUser } from './phone-auth';
import { resolveRole, Role, saveSession, StoredSession } from './session';
import { font } from './theme';

/**
 * Native sign-in screen (customers and operator staff), in the app's
 * travel-booking style: blue gradient hero with the heading, form in a white
 * card overlapping it, gradient pill button.
 *
 * Authentication is RaftNow's real one: phone number → one-time SMS code
 * (Firebase, native SDK) → the API decides the account type (GET /vendor/me).
 * On a local development API (firebase_auth = "dev_bypass_only") a clearly
 * labelled developer sign-in replaces the SMS step; production servers refuse it.
 */

type View_ = 'phone' | 'code' | 'dev';
type PhoneMode = 'firebase' | 'dev' | 'server-off' | 'app-off';

const RESEND_SECONDS = 30;

/** Accepts 10-digit Indian mobiles (optionally with 0 / 91 / +91) or any E.164 number. */
export function normalisePhone(raw: string): string | null {
  const s = raw.replace(/[\s\-().]/g, '');
  if (/^\+[1-9]\d{7,14}$/.test(s)) return s;
  if (/^0?[6-9]\d{9}$/.test(s)) return `+91${s.slice(-10)}`;
  if (/^91[6-9]\d{9}$/.test(s)) return `+${s}`;
  return null;
}
const displayPhone = (e164: string) => (/^\+91\d{10}$/.test(e164) ? `+91 ${e164.slice(3, 8)} ${e164.slice(8)}` : e164);

function messageFor(err: unknown): string {
  const fb = phoneAuthErrorMessage(err);
  if (fb) return fb;
  if (err instanceof ApiError) {
    if (err.status === 0) return 'Can’t reach RaftNow right now. Check your connection and try again.';
    if (err.status === 429) return 'Too many attempts. Please wait a minute and try again.';
    if (err.status >= 500) return 'Something went wrong on our side. Please try again in a moment.';
    if (err.status === 401) return 'RaftNow couldn’t verify this sign-in. Please try again.';
    return err.message;
  }
  return err instanceof Error ? err.message : 'Sign-in failed. Please try again.';
}

// ── Small presentational pieces ──────────────────────────────────────────────

function Notice({ tone, children, action }: { tone: 'error' | 'info' | 'warn'; children: React.ReactNode; action?: { label: string; onPress: () => void } }) {
  const c = {
    error: { bg: '#fff1f2', border: '#fecdd3', text: '#9f1239' },
    info: { bg: '#f0f9ff', border: '#bae6fd', text: '#0c4a6e' },
    warn: { bg: '#fffbeb', border: '#fde68a', text: '#78350f' },
  }[tone];
  return (
    <View
      accessibilityRole={tone === 'error' ? 'alert' : 'summary'}
      accessibilityLiveRegion="polite"
      style={[styles.notice, { backgroundColor: c.bg, borderColor: c.border }]}
    >
      <Svg width={16} height={16} viewBox="0 0 24 24" style={{ marginTop: 2 }}>
        <Circle cx={12} cy={12} r={10} stroke={c.text} strokeWidth={2} fill="none" />
        <Path d={tone === 'info' ? 'M12 16v-4M12 8h.01' : 'M12 8v4M12 16h.01'} stroke={c.text} strokeWidth={2} strokeLinecap="round" />
      </Svg>
      <View style={{ flex: 1 }}>
        <Text style={[styles.noticeText, { color: c.text }]}>{children}</Text>
        {action && (
          <Pressable accessibilityRole="button" onPress={action.onPress} hitSlop={10} style={{ marginTop: 6, alignSelf: 'flex-start' }}>
            <Text style={[styles.noticeText, { color: c.text, fontFamily: font.body600, textDecorationLine: 'underline' }]}>{action.label}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

/** Labelled input with a 2px blue focus ring (drawn outside the box, so nothing shifts). */
function Field({
  id,
  label,
  error,
  hint,
  style,
  ...input
}: TextInputProps & { id: string; label: string; error?: string | null; hint?: React.ReactNode }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ marginBottom: error || hint ? 8 : 24 }}>
      <Text nativeID={`${id}-label`} style={styles.label}>
        {label}
      </Text>
      <View>
        <TextInput
          {...input}
          accessibilityLabel={label}
          accessibilityLabelledBy={`${id}-label`}
          accessibilityHint={error ?? undefined}
          placeholderTextColor="#a3a3a3"
          keyboardAppearance="light"
          selectionColor={c.primary}
          cursorColor={c.primary}
          underlineColorAndroid="transparent"
          onFocus={(e) => {
            setFocused(true);
            input.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            input.onBlur?.(e);
          }}
          style={[
            styles.input,
            { borderColor: focused ? 'transparent' : error ? c.error : '#d9d9d9' },
            style,
          ]}
        />
        {focused && <View pointerEvents="none" style={styles.focusRing} />}
      </View>
      {error ? (
        <Text accessibilityLiveRegion="polite" style={styles.fieldError}>
          {error}
        </Text>
      ) : null}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

function LinkButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={12}
      style={({ pressed }) => ({ paddingVertical: 2, opacity: pressed ? 0.6 : 1 })}
    >
      <Text style={[styles.link, disabled && { color: c.muted }]}>{label}</Text>
    </Pressable>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────

export function LoginScreen({ notice: initialNotice, onSignedIn }: { notice: string | null; onSignedIn: (s: StoredSession) => void }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = width >= 640;

  const [view, setView] = useState<View_>('phone');
  const [mode, setMode] = useState<PhoneMode | null>(null);
  const [healthFailed, setHealthFailed] = useState(false);
  const [notice, setNotice] = useState<string | null>(initialNotice);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const [phone, setPhone] = useState('');
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [sentTo, setSentTo] = useState('');
  const [code, setCode] = useState('');
  const [devUid, setDevUid] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const confirmation = useRef<ConfirmationResult | null>(null);
  const modePromise = useRef<Promise<PhoneMode> | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  // When the keyboard opens, scroll so the active field and its button sit just above it.
  useEffect(() => {
    const sub = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () =>
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), Platform.OS === 'ios' ? 280 : 50),
    );
    return () => sub.remove();
  }, []);

  // Which phone sign-in the server (and this app build) supports.
  const loadMode = useCallback((): Promise<PhoneMode> => {
    modePromise.current ??= api<Health>('/health')
      .then((h) => {
        const m: PhoneMode =
          h.integrations.firebase_auth === 'configured'
            ? firebaseAuth()
              ? 'firebase'
              : 'app-off'
            : h.integrations.firebase_auth === 'dev_bypass_only'
              ? 'dev'
              : 'server-off';
        setMode(m);
        setHealthFailed(false);
        return m;
      })
      .catch((e) => {
        modePromise.current = null;
        setHealthFailed(true);
        throw e;
      });
    return modePromise.current;
  }, []);

  useEffect(() => {
    loadMode().catch(() => undefined);
  }, [loadMode]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  useEffect(() => {
    if (error) AccessibilityInfo.announceForAccessibility(error);
  }, [error]);

  const switchTo = useCallback((v: View_) => {
    setError(null);
    setNotice(null);
    setCode('');
    setView(v);
  }, []);

  // Android hardware back: from the code / developer step return to the phone step.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (view === 'phone' || inFlight.current) return false;
      switchTo('phone');
      return true;
    });
    return () => sub.remove();
  }, [view, switchTo]);

  /** One submission at a time: repeated taps are ignored while a request is running. */
  const submit = async (fn: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError(messageFor(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const finishFirebase = async (user: FirebaseUser) => {
    const token = await idToken(user);
    let role: Role;
    try {
      role = await resolveRole(token);
    } catch (e) {
      await firebaseSignOut().catch(() => undefined);
      throw e;
    }
    const session: StoredSession = { kind: 'firebase', phone: sentTo || user.phoneNumber || '', role };
    await saveSession(session);
    onSignedIn(session);
  };

  // Android can verify the SMS automatically; Firebase then signs the user in without the code being typed.
  useEffect(() => {
    if (view !== 'code' || mode !== 'firebase') return;
    if (!firebaseAuth()) return;
    return onFirebaseUser((user) => {
      if (user && !inFlight.current) void submit(() => finishFirebase(user));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, mode]);

  // ── Phone step ──
  const e164 = normalisePhone(phone);
  const phoneError = phoneTouched && phone.trim() !== '' && !e164 ? 'Enter a 10-digit mobile number, or include the country code.' : null;

  const onSendCode = () => {
    setPhoneTouched(true);
    if (!e164) return;
    void submit(async () => {
      const m = await loadMode();
      if (m === 'firebase') {
        confirmation.current = await sendSmsCode(e164);
        setSentTo(e164);
        setResendIn(RESEND_SECONDS);
        switchTo('code');
      } else if (m === 'dev') {
        setSentTo(e164);
        setDevUid((u) => u || `p${e164.replace(/\D/g, '')}`);
        switchTo('dev');
      } else {
        throw new Error(m === 'app-off' ? 'This version of the app can’t send sign-in codes. Please update RaftNow.' : 'Phone sign-in isn’t set up on this server yet.');
      }
    });
  };

  const onResend = () =>
    void submit(async () => {
      confirmation.current = await sendSmsCode(sentTo);
      setResendIn(RESEND_SECONDS);
      setNotice(`We sent a new code to ${displayPhone(sentTo)}.`);
    });

  const onVerify = () => {
    if (!/^\d{6}$/.test(code) || !confirmation.current) return;
    const c = confirmation.current;
    void submit(async () => {
      const cred = await c.confirm(code);
      const user = cred?.user ?? firebaseAuth()?.currentUser;
      if (!user) throw new Error('Sign-in didn’t complete. Please request a new code.');
      await finishFirebase(user);
    });
  };

  const onDevContinue = () => {
    if (devUid.length < 3) return;
    void submit(async () => {
      const token = `dev:${devUid}:${sentTo}`;
      const role = await resolveRole(token); // the API validates the token; nothing is assumed here
      const session: StoredSession = { kind: 'dev', phone: sentTo, role, devToken: token };
      await saveSession(session);
      onSignedIn(session);
    });
  };

  const heading = view === 'code' ? 'Enter verification code' : view === 'dev' ? 'Developer sign-in' : 'Welcome to RaftNow';
  const phoneUnavailable = mode === 'server-off' || mode === 'app-off';

  const subtitle =
    view === 'code' ? null : view === 'dev' ? 'Local development sign-in' : 'Log in or create an account with your mobile number';

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <StatusBar style="light" />
      {/* Android apps are edge-to-edge on SDK 54+, so the window no longer resizes for the keyboard: pad on both platforms. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom + 24 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.hero, { paddingTop: insets.top + (wide ? 48 : 32), paddingHorizontal: wide ? 40 : 24 }]}>
            <GradientFill from={c.heroFrom} to={c.heroTo} />
            <View style={[styles.column, { alignItems: 'flex-start' }]}>
              <View style={styles.brandRow} accessible accessibilityRole="image" accessibilityLabel="RaftNow">
                <Icon name="waves" size={28} color="#ffffff" strokeWidth={2.4} />
                <Text style={styles.brand}>
                  Raft<Text style={{ color: c.primaryLight }}>Now</Text>
                </Text>
              </View>
              <Text accessibilityRole="header" style={[styles.h1, wide && { fontSize: 30, lineHeight: 36 }]}>
                {heading}
              </Text>
              {subtitle && <Text style={styles.sub}>{subtitle}</Text>}
              {view === 'code' && (
                <Text style={styles.sub}>
                  We sent a 6-digit code to <Text style={{ color: '#ffffff', fontFamily: font.body600 }}>{displayPhone(sentTo)}</Text>.
                </Text>
              )}
            </View>
          </View>

          <View style={{ paddingHorizontal: wide ? 40 : 16 }}>
          <View style={[styles.column, styles.card]}>
            {notice && <Notice tone="info">{notice}</Notice>}
            {error && <Notice tone="error">{error}</Notice>}
            {view === 'phone' && healthFailed && !error && (
              <Notice tone="error" action={{ label: 'Try again', onPress: () => loadMode().catch(() => undefined) }}>
                {`Can’t reach RaftNow at ${API_URL}. Check your connection.`}
              </Notice>
            )}

            {view === 'phone' && (
              <>
                {phoneUnavailable && (
                  <Notice tone="warn">
                    {mode === 'app-off'
                      ? 'This version of the app can’t send sign-in codes. Please update RaftNow.'
                      : 'Phone sign-in isn’t set up on this server yet.'}
                  </Notice>
                )}
                <Field
                  id="phone"
                  label="Phone number"
                  value={phone}
                  onChangeText={setPhone}
                  onBlur={() => setPhoneTouched(true)}
                  placeholder="9876543210"
                  keyboardType="phone-pad"
                  textContentType="telephoneNumber"
                  autoComplete="tel"
                  maxLength={18}
                  error={phoneError}
                  editable={!busy}
                />
                {/* marginBottom keeps the reference's vertical balance (its secondary link row sits here). */}
                <View style={{ marginTop: phoneError ? 8 : -12 }}>
                  <Button label={busy ? 'Sending code…' : 'Continue'} busy={busy} disabled={!e164 || phoneUnavailable} onPress={onSendCode} />
                </View>
              </>
            )}

            {view === 'code' && (
              <>
                <Field
                  id="code"
                  label="Verification code"
                  value={code}
                  onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
                  placeholder="123456"
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                  autoComplete="sms-otp"
                  maxLength={6}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={onVerify}
                  editable={!busy}
                  style={{ letterSpacing: 4 }}
                />
                <Button label={busy ? 'Verifying…' : 'Verify & continue'} busy={busy} disabled={code.length !== 6} onPress={onVerify} style={{ marginTop: -12 }} />
                <View style={styles.linkRow}>
                  <LinkButton label="Use a different number" disabled={busy} onPress={() => switchTo('phone')} />
                  <LinkButton label={resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'} disabled={busy || resendIn > 0} onPress={onResend} />
                </View>
              </>
            )}

            {view === 'dev' && (
              <>
                <Notice tone="warn">
                  {`Local development only. No SMS was sent: this server accepts developer tokens for ${displayPhone(sentTo)}. A production server refuses them.`}
                </Notice>
                <Field
                  id="dev-uid"
                  label="Developer user id"
                  value={devUid}
                  onChangeText={(t) => setDevUid(t.replace(/[^A-Za-z0-9_-]/g, ''))}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoFocus
                  returnKeyType="go"
                  onSubmitEditing={onDevContinue}
                  editable={!busy}
                  hint="Seeded operator owner: vendor-owner with 9876543210."
                />
                <Button label={busy ? 'Signing in…' : 'Continue'} busy={busy} disabled={devUid.length < 3} onPress={onDevContinue} />
                <View style={[styles.linkRow, { justifyContent: 'center' }]}>
                  <LinkButton label="Use a different number" disabled={busy} onPress={() => switchTo('phone')} />
                </View>
              </>
            )}
          </View>
          </View>
          <Text style={styles.terms}>By continuing you agree to RaftNow’s Terms of Service and Privacy Policy.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  column: { width: '100%', maxWidth: 448, alignSelf: 'center' },
  hero: { paddingBottom: 72, overflow: 'hidden' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 28 },
  brand: { fontFamily: font.display800, fontSize: 26, color: '#ffffff', letterSpacing: -0.4 },
  h1: { fontFamily: font.display800, fontSize: 26, lineHeight: 32, color: '#ffffff', letterSpacing: -0.3 },
  sub: { fontFamily: font.body400, fontSize: 15, lineHeight: 21, color: c.onHeroMuted, marginTop: 6 },
  card: {
    backgroundColor: c.card,
    borderRadius: 14,
    padding: 20,
    marginTop: -48,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 14, shadowOffset: { width: 0, height: 4 } },
      android: { elevation: 4 },
    }),
  },
  terms: { fontFamily: font.body400, fontSize: 12, lineHeight: 18, color: c.muted, textAlign: 'center', marginTop: 20, paddingHorizontal: 32 },
  label: { fontFamily: font.body600, fontSize: 13, lineHeight: 18, color: c.muted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    height: 50,
    paddingHorizontal: 16,
    paddingVertical: 0,
    borderWidth: 1,
    borderRadius: 10,
    backgroundColor: '#ffffff',
    color: c.text,
    fontFamily: font.body500,
    fontSize: 17,
  },
  focusRing: { position: 'absolute', top: -2, left: -2, right: -2, bottom: -2, borderRadius: 12, borderWidth: 2, borderColor: c.primary },
  fieldError: { fontFamily: font.body400, fontSize: 14, lineHeight: 20, color: c.error, marginTop: 8 },
  hint: { fontFamily: font.body400, fontSize: 14, lineHeight: 20, color: c.muted, marginTop: 8 },
  link: { fontFamily: font.body600, fontSize: 14, lineHeight: 20, color: c.primary },
  linkRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, gap: 12, flexWrap: 'wrap' },
  notice: { flexDirection: 'row', gap: 10, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 20 },
  noticeText: { fontFamily: font.body400, fontSize: 14, lineHeight: 20 },
});
