import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { ConfirmationResult } from 'firebase/auth';
import { AlertCircle, CheckCircle2, Info, Loader2 } from 'lucide-react';
import heroUrl from '../assets/login-hero.svg';
import { ApiError, publicApi, request } from '../lib/api';
import { firebaseConfigured, getDevToken, getToken, phoneAuthErrorMessage, sendOtp, setDevToken, signOut } from '../lib/phone-auth';
import { fetchAdminMe, readAdminToken, writeAdminToken } from '../lib/admin-session';
import { RaftNowMark, RaftNowWordmark } from '../components/RaftNowLogo';

/**
 * /login — one sign-in screen for every RaftNow account type, using the
 * authentication the API already enforces:
 *
 *  - Customers and operator staff: phone number → one-time SMS code (Firebase).
 *    Where they land is decided by the API: an active operator staff member
 *    (GET /vendor/me succeeds) goes to /vendor, everyone else to /.
 *  - RaftNow staff ("Sign in with a password instead"): email + password, then
 *    the mandatory authenticator-app code (or first-time 2FA enrolment) → /admin.
 *
 * `?next=/path` returns the user to the page that sent them here. Nothing on
 * this screen grants access by itself: every session is verified by the API
 * before redirecting, and the dashboards re-check it on load.
 */

type View = 'checking' | 'phone' | 'code' | 'dev' | 'password' | 'totp' | 'enroll' | 'done';
type PhoneMode = 'firebase' | 'dev' | 'none';

const RESEND_SECONDS = 30;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Accepts 10-digit Indian mobiles (with optional 0 / 91 / +91) or any E.164 number. */
export function normalisePhone(raw: string): string | null {
  const s = raw.replace(/[\s\-().]/g, '');
  if (/^\+[1-9]\d{7,14}$/.test(s)) return s;
  if (/^0?[6-9]\d{9}$/.test(s)) return `+91${s.slice(-10)}`;
  if (/^91[6-9]\d{9}$/.test(s)) return `+${s}`;
  return null;
}

const displayPhone = (e164: string) => (/^\+91\d{10}$/.test(e164) ? `+91 ${e164.slice(3, 8)} ${e164.slice(8)}` : e164);

/** Only same-origin paths are allowed as redirect targets (no open redirects). */
function safeNext(raw: string | null): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null;
  if (/^\/login(?:[/?#]|$)/.test(raw)) return null;
  return raw;
}
const isAdminPath = (p: string) => /^\/admin(?:[/?#]|$)/.test(p);

/** Asks the API who this phone identity is. Throws ApiError if the token itself is rejected. */
async function phoneAccountKind(token: string): Promise<'vendor' | 'customer'> {
  try {
    await request('/vendor/me', { token: () => token });
    return 'vendor';
  } catch (e) {
    if (e instanceof ApiError && e.status === 401 && /vendor staff/i.test(e.message)) return 'customer';
    throw e;
  }
}

async function signOutPhone() {
  await Promise.allSettled([signOut('customer'), signOut('vendor')]);
}

function apiMessage(err: unknown, context: 'password' | 'totp' | 'phone'): string {
  const fb = phoneAuthErrorMessage(err);
  if (fb) return fb;
  if (err instanceof ApiError) {
    if (err.status === 0) return 'Can’t reach RaftNow right now. Check your connection and try again.';
    if (err.status === 429) return 'Too many attempts. Please wait a minute and try again.';
    if (err.status === 423) return 'Too many failed attempts — this account is temporarily locked. Try again in 15 minutes.';
    if (err.status >= 500) return 'Something went wrong on our side. Please try again in a moment.';
    if (err.status === 401) {
      if (context === 'password') return 'Incorrect email or password.';
      if (context === 'totp') return 'That code didn’t work. Check your authenticator app and try again.';
      return 'RaftNow couldn’t verify this sign-in. Please try again.';
    }
    return err.message;
  }
  return err instanceof Error ? err.message : 'Sign-in failed. Please try again.';
}

// ── Presentational pieces (light "river mist" theme) ─────────────────────────

const inputCls =
  'w-full px-4 py-3 border border-ink-line rounded-field bg-white text-ink placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-aqua focus:border-transparent aria-[invalid=true]:border-rose-400';
const labelCls = 'block text-sm font-medium text-ink mb-2';
const linkCls =
  'text-sm text-aqua-dark hover:underline disabled:text-ink-muted disabled:no-underline disabled:cursor-not-allowed rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-aqua focus-visible:ring-offset-2';

const PrimaryButton: React.FC<{ busy?: boolean; disabled?: boolean; busyLabel: string; children: React.ReactNode }> = ({ busy, disabled, busyLabel, children }) => (
  <button
    type="submit"
    disabled={disabled || busy}
    aria-busy={busy || undefined}
    className="w-full py-3 mb-4 inline-flex items-center justify-center gap-2 bg-aqua-glossy text-white font-display font-bold tracking-tight rounded-cta shadow-cta hover:shadow-cta-hover hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-cta transition-all duration-150 motion-reduce:transition-none motion-reduce:hover:translate-y-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-aqua-dark focus-visible:ring-offset-2 focus-visible:ring-offset-[#f0f8fb]"
  >
    {busy && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />}
    {busy ? busyLabel : children}
  </button>
);

const Alert: React.FC<{ tone: 'error' | 'info' | 'warn' | 'ok'; children: React.ReactNode }> = ({ tone, children }) => {
  const styles = {
    error: 'border-rose-200 bg-rose-50 text-rose-800',
    info: 'border-sky-200 bg-sky-50 text-sky-900',
    warn: 'border-amber-200 bg-amber-50 text-amber-900',
    ok: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  }[tone];
  const Icon = tone === 'error' ? AlertCircle : tone === 'ok' ? CheckCircle2 : Info;
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`mb-6 flex items-start gap-2.5 rounded-field border px-4 py-3 text-sm ${styles}`}>
      <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
};

const FieldError: React.FC<{ id: string; message: string | null }> = ({ id, message }) =>
  message ? (
    <p id={id} className="-mt-4 mb-6 text-sm text-rose-700">
      {message}
    </p>
  ) : null;

// ── Page ─────────────────────────────────────────────────────────────────────

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const wantsAdmin = params.get('mode') === 'password' || (next !== null && isAdminPath(next));
  const reason = params.get('reason');

  // A session we can see synchronously is checked before showing the form (no flash of the form).
  const [view, setView] = useState<View>(() =>
    readAdminToken() || getDevToken('customer') || getDevToken('vendor') ? 'checking' : wantsAdmin ? 'password' : 'phone',
  );
  const [notice, setNotice] = useState<string | null>(
    reason === 'expired' ? 'Your session has expired. Please sign in again.' : reason === 'signed_out' ? 'You’ve been signed out.' : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  // Phone sign-in
  const [phoneMode, setPhoneMode] = useState<PhoneMode | null>(null);
  const phoneModeRef = useRef<Promise<PhoneMode> | null>(null);
  const [phone, setPhone] = useState('');
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [sentTo, setSentTo] = useState('');
  const [code, setCode] = useState('');
  const confirmation = useRef<ConfirmationResult | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [devUid, setDevUid] = useState('');

  // Password (RaftNow staff) sign-in
  const [email, setEmail] = useState('');
  const [emailTouched, setEmailTouched] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [mfaToken, setMfaToken] = useState('');
  const [enrollToken, setEnrollToken] = useState('');
  const [enrollment, setEnrollment] = useState<{ qr_data_url: string; secret: string } | null>(null);
  const [totp, setTotp] = useState('');

  const go = useCallback((to: string) => navigate(to, { replace: true }), [navigate]);

  useEffect(() => {
    const prev = document.title;
    document.title = 'Sign in · RaftNow';
    return () => {
      document.title = prev;
    };
  }, []);

  // Which phone sign-in the server supports (real Firebase OTP, local dev tokens, or none).
  const loadPhoneMode = useCallback((): Promise<PhoneMode> => {
    phoneModeRef.current ??= publicApi
      .health()
      .then((h) => {
        const m: PhoneMode =
          firebaseConfigured && h.integrations.firebase_auth === 'configured'
            ? 'firebase'
            : h.integrations.firebase_auth === 'dev_bypass_only'
              ? 'dev'
              : 'none';
        setPhoneMode(m);
        return m;
      })
      .catch((e) => {
        phoneModeRef.current = null; // retry on the next attempt
        throw e;
      });
    return phoneModeRef.current;
  }, []);

  // Already signed in? Verify with the API and send the user on.
  useEffect(() => {
    let cancelled = false;
    loadPhoneMode().catch(() => undefined);
    (async () => {
      let expired = false;
      if (readAdminToken() && (wantsAdmin || !next)) {
        try {
          await fetchAdminMe();
          if (!cancelled) go(next && isAdminPath(next) ? next : '/admin');
          return;
        } catch (e) {
          if (e instanceof ApiError && e.status === 401) {
            writeAdminToken(null);
            expired = true;
          } else if (!cancelled) setError(apiMessage(e, 'password'));
        }
      }
      if (!wantsAdmin) {
        try {
          // Check the session the destination itself will use, so /login and a dashboard can never bounce between each other.
          const token = next
            ? await getToken(/^\/vendor(?:[/?#]|$)/.test(next) ? 'vendor' : 'customer')
            : ((await getToken('vendor')) ?? (await getToken('customer')));
          if (token) {
            const kind = await phoneAccountKind(token);
            if (!cancelled) go(next ?? (kind === 'vendor' ? '/vendor' : '/'));
            return;
          }
        } catch (e) {
          if (e instanceof ApiError && e.status === 401) {
            await signOutPhone();
            expired = true;
          } else if (!cancelled) setError(apiMessage(e, 'phone'));
        }
      }
      if (cancelled) return;
      if (expired) setNotice('Your session has expired. Please sign in again.');
      setView((v) => (v === 'checking' ? (wantsAdmin ? 'password' : 'phone') : v));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  /** Runs one submission at a time; double clicks / double Enter are ignored. */
  const submit = async (fn: () => Promise<void>, context: 'password' | 'totp' | 'phone') => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError(apiMessage(e, context));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const finishPhone = async (token: string) => {
    let kind: 'vendor' | 'customer';
    try {
      kind = await phoneAccountKind(token);
    } catch (e) {
      await signOutPhone();
      throw e;
    }
    setView('done');
    go(next && !isAdminPath(next) ? next : kind === 'vendor' ? '/vendor' : '/');
  };

  const finishAdmin = (r: { access_token: string }) => {
    writeAdminToken(r.access_token);
    setView('done');
    go(next && isAdminPath(next) ? next : '/admin');
  };

  const switchTo = (v: View) => {
    setError(null);
    setNotice(null);
    setCode('');
    setTotp('');
    setView(v);
  };

  // ── Phone ──
  const e164 = normalisePhone(phone);
  const phoneError = phoneTouched && phone.trim() !== '' && !e164 ? 'Enter a 10-digit mobile number, or include the country code.' : null;

  const onSendCode = (ev: React.FormEvent) => {
    ev.preventDefault();
    setPhoneTouched(true);
    if (!e164) return;
    void submit(async () => {
      const mode = await loadPhoneMode();
      if (mode === 'firebase') {
        confirmation.current = await sendOtp(e164, 'login-recaptcha');
        setSentTo(e164);
        setResendIn(RESEND_SECONDS);
        switchTo('code');
      } else if (mode === 'dev') {
        setSentTo(e164);
        setDevUid((u) => u || `p${e164.replace(/\D/g, '')}`);
        switchTo('dev');
      } else {
        throw new Error('Phone sign-in isn’t set up on this server yet.');
      }
    }, 'phone');
  };

  const onResend = () =>
    void submit(async () => {
      confirmation.current = await sendOtp(sentTo, 'login-recaptcha');
      setResendIn(RESEND_SECONDS);
      setNotice(`We sent a new code to ${displayPhone(sentTo)}.`);
    }, 'phone');

  const onVerifyCode = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!/^\d{6}$/.test(code) || !confirmation.current) return;
    const c = confirmation.current;
    void submit(async () => {
      const cred = await c.confirm(code);
      await finishPhone(await cred.user.getIdToken());
    }, 'phone');
  };

  const onDevContinue = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (devUid.length < 3) return;
    void submit(async () => {
      // One phone identity, as with Firebase: the same dev token serves the customer and operator areas.
      setDevToken('customer', devUid, sentTo);
      await finishPhone(setDevToken('vendor', devUid, sentTo));
    }, 'phone');
  };

  // ── Password + TOTP ──
  const emailError = emailTouched && email.trim() !== '' && !EMAIL_RE.test(email.trim()) ? 'Enter a valid email address.' : null;

  const onPasswordSignIn = (ev: React.FormEvent) => {
    ev.preventDefault();
    setEmailTouched(true);
    if (!EMAIL_RE.test(email.trim()) || !password) return;
    void submit(async () => {
      const pw = password;
      setPassword('');
      setShowPassword(false);
      const r = await request<{ step: 'VERIFY_TOTP' | 'ENROLL_TOTP'; mfa_token?: string; enrollment_token?: string }>('/admin/auth/login', {
        body: { email: email.trim(), password: pw },
      });
      if (r.step === 'VERIFY_TOTP' && r.mfa_token) {
        setMfaToken(r.mfa_token);
        switchTo('totp');
      } else if (r.step === 'ENROLL_TOTP' && r.enrollment_token) {
        const token = r.enrollment_token;
        setEnrollToken(token);
        setEnrollment(await request('/admin/auth/totp/setup', { method: 'POST', token: () => token }));
        switchTo('enroll');
      } else {
        throw new Error('Unexpected response from the sign-in service.');
      }
    }, 'password');
  };

  /** A 401 that is not about the code means the short-lived mfa/enrolment token lapsed. */
  const totpSubmit = (call: () => Promise<{ access_token: string }>) =>
    void submit(async () => {
      try {
        finishAdmin(await call());
      } catch (e) {
        if (e instanceof ApiError && e.status === 401 && !/authentication code/i.test(e.message)) {
          setMfaToken('');
          setEnrollToken('');
          setEnrollment(null);
          switchTo('password');
          throw new Error('Your sign-in timed out. Enter your password again.');
        }
        setTotp('');
        throw e;
      }
    }, 'totp');

  const onVerifyTotp = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!/^\d{6}$/.test(totp)) return;
    totpSubmit(() => request('/admin/auth/mfa/verify', { body: { mfa_token: mfaToken, code: totp } }));
  };

  const onEnableTotp = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!/^\d{6}$/.test(totp)) return;
    totpSubmit(() => request('/admin/auth/totp/enable', { body: { code: totp }, token: () => enrollToken }));
  };

  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 6);

  const heading = {
    checking: 'Welcome back',
    phone: 'Welcome back',
    password: 'Welcome back',
    code: 'Enter your code',
    dev: 'Developer sign-in',
    totp: 'Two-step verification',
    enroll: 'Set up two-step verification',
    done: 'Welcome back',
  }[view];

  return (
    <div className="min-h-screen grid lg:grid-cols-[40%_60%] font-body">
      {/* Brand panel (large screens only, as in the reference layout) */}
      <div
        className="relative hidden lg:flex flex-col justify-between p-12 text-white bg-cover bg-center"
        style={{
          backgroundImage: `linear-gradient(180deg, rgba(14,42,74,0.05) 0%, rgba(14,42,74,0.2) 45%, rgba(14,42,74,0.82) 100%), url(${heroUrl})`,
        }}
      >
        <div className="inline-flex items-center gap-2.5 drop-shadow-[0_2px_8px_rgba(0,0,0,0.45)]">
          <RaftNowMark className="h-10 w-10" />
          <RaftNowWordmark tone="light" className="text-[26px]" />
        </div>
        <div>
          <h2 className="font-display font-bold text-4xl leading-tight mb-3">
            Rishikesh rafting,
            <br />
            booked in one place.
          </h2>
          <p className="text-base text-white/85 max-w-md">
            Seats and private rafts with licensed operators — departures, manifests and QR check-in in one account.
          </p>
          <div className="flex gap-1.5 mt-6" aria-hidden="true">
            <span className="h-1.5 w-7 rounded bg-sand" />
            <span className="h-1.5 w-1.5 rounded-full bg-white/40" />
            <span className="h-1.5 w-1.5 rounded-full bg-white/40" />
          </div>
        </div>
      </div>

      {/* Sign-in panel */}
      <main className="bg-page-mist flex items-center justify-center p-6 sm:p-10 lg:p-12 min-h-screen">
        <div className="w-full max-w-md">
          <div className="flex flex-col items-center gap-5 mb-8">
            <RaftNowMark className="h-16 w-16" />
            <RaftNowWordmark className="text-[32px]" />
          </div>

          <div className="mb-6">
            <h1 className="font-display font-extrabold text-2xl sm:text-3xl text-ink-strong">{heading}</h1>
            {view === 'code' && (
              <p className="mt-2 text-sm text-ink-muted">
                We sent a 6-digit code to <span className="font-medium text-ink">{displayPhone(sentTo)}</span>.
              </p>
            )}
            {view === 'totp' && <p className="mt-2 text-sm text-ink-muted">Enter the 6-digit code from your authenticator app.</p>}
          </div>

          {notice && <Alert tone="info">{notice}</Alert>}
          {error && <Alert tone="error">{error}</Alert>}

          {view === 'checking' && (
            <p role="status" className="flex items-center gap-2 text-sm text-ink-muted">
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" /> Checking your session…
            </p>
          )}

          {view === 'done' && (
            <p role="status" className="flex items-center gap-2 text-sm text-emerald-800">
              <CheckCircle2 aria-hidden="true" className="h-4 w-4" /> Signed in — taking you to your dashboard…
            </p>
          )}

          {view === 'phone' && (
            <form onSubmit={onSendCode} noValidate>
              {phoneMode === 'none' && (
                <Alert tone="warn">Phone sign-in isn’t set up on this server yet. RaftNow staff can still sign in with a password.</Alert>
              )}
              <label htmlFor="login-phone" className={labelCls}>
                Phone number
              </label>
              <input
                id="login-phone"
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="9876543210"
                required
                autoFocus
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onBlur={() => setPhoneTouched(true)}
                aria-invalid={!!phoneError}
                aria-describedby={phoneError ? 'login-phone-error' : undefined}
                className={`${inputCls} mb-6`}
              />
              <FieldError id="login-phone-error" message={phoneError} />
              <PrimaryButton busy={busy} busyLabel="Sending code…" disabled={!e164 || phoneMode === 'none'}>
                Send code
              </PrimaryButton>
              <div className="text-center">
                <button type="button" className={linkCls} disabled={busy} onClick={() => switchTo('password')}>
                  Sign in with a password instead
                </button>
              </div>
            </form>
          )}

          {view === 'code' && (
            <form onSubmit={onVerifyCode} noValidate>
              <label htmlFor="login-code" className={labelCls}>
                Verification code
              </label>
              <input
                id="login-code"
                name="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="123456"
                required
                autoFocus
                value={code}
                onChange={(e) => setCode(digits(e.target.value))}
                className={`${inputCls} mb-6 tracking-[0.3em]`}
              />
              <PrimaryButton busy={busy} busyLabel="Verifying…" disabled={code.length !== 6}>
                Verify
              </PrimaryButton>
              <div className="flex items-center justify-between gap-3">
                <button type="button" className={linkCls} disabled={busy} onClick={() => switchTo('phone')}>
                  Use a different number
                </button>
                <button type="button" className={linkCls} disabled={busy || resendIn > 0} onClick={onResend}>
                  {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
                </button>
              </div>
            </form>
          )}

          {view === 'dev' && (
            <form onSubmit={onDevContinue} noValidate>
              <Alert tone="warn">
                <strong className="font-semibold">Local development only.</strong> No SMS was sent: this API runs with AUTH_DEV_BYPASS and no
                Firebase project, so it accepts developer tokens for {displayPhone(sentTo)}. A production server refuses them.
              </Alert>
              <label htmlFor="login-dev-uid" className={labelCls}>
                Developer user id
              </label>
              <input
                id="login-dev-uid"
                name="dev-uid"
                type="text"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                required
                autoFocus
                value={devUid}
                onChange={(e) => setDevUid(e.target.value.replace(/[^A-Za-z0-9_-]/g, ''))}
                aria-describedby="login-dev-uid-hint"
                className={`${inputCls} mb-2`}
              />
              <p id="login-dev-uid-hint" className="mb-6 text-sm text-ink-muted">
                Seeded operator owner: <code className="font-mono text-ink">vendor-owner</code> with 9876543210.
              </p>
              <PrimaryButton busy={busy} busyLabel="Signing in…" disabled={devUid.length < 3}>
                Continue
              </PrimaryButton>
              <div className="text-center">
                <button type="button" className={linkCls} disabled={busy} onClick={() => switchTo('phone')}>
                  Use a different number
                </button>
              </div>
            </form>
          )}

          {view === 'password' && (
            <form onSubmit={onPasswordSignIn} noValidate>
              <label htmlFor="login-email" className={labelCls}>
                Email
              </label>
              <input
                id="login-email"
                name="email"
                type="email"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="you@raftnow.in"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => setEmailTouched(true)}
                aria-invalid={!!emailError}
                aria-describedby={emailError ? 'login-email-hint login-email-error' : 'login-email-hint'}
                className={`${inputCls} mb-2`}
              />
              <p id="login-email-hint" className="mb-6 text-sm text-ink-muted">
                Password sign-in is for RaftNow team accounts. Customers and operators use a one-time code.
              </p>
              <FieldError id="login-email-error" message={emailError} />
              <label htmlFor="login-password" className={labelCls}>
                Password
              </label>
              <div className="relative mb-6">
                <input
                  id="login-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`${inputCls} pr-16`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-controls="login-password"
                  aria-pressed={showPassword}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded px-1 text-sm text-ink-muted hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-aqua"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              <PrimaryButton busy={busy} busyLabel="Signing in…" disabled={!email.trim() || !password}>
                Sign in
              </PrimaryButton>
              <div className="text-center">
                <button type="button" className={linkCls} disabled={busy} onClick={() => switchTo('phone')}>
                  Use a one-time code instead
                </button>
              </div>
            </form>
          )}

          {view === 'totp' && (
            <form onSubmit={onVerifyTotp} noValidate>
              <label htmlFor="login-totp" className={labelCls}>
                Authentication code
              </label>
              <input
                id="login-totp"
                name="totp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="123456"
                required
                autoFocus
                value={totp}
                onChange={(e) => setTotp(digits(e.target.value))}
                className={`${inputCls} mb-6 tracking-[0.3em]`}
              />
              <PrimaryButton busy={busy} busyLabel="Verifying…" disabled={totp.length !== 6}>
                Verify
              </PrimaryButton>
              <div className="text-center">
                <button type="button" className={linkCls} disabled={busy} onClick={() => switchTo('password')}>
                  Start over
                </button>
              </div>
            </form>
          )}

          {view === 'enroll' && enrollment && (
            <form onSubmit={onEnableTotp} noValidate>
              <p className="mb-4 text-sm text-ink-muted">
                Two-step verification is required for RaftNow team accounts. Scan this code with Google Authenticator, 1Password or a similar app,
                then enter the 6-digit code it shows.
              </p>
              <img
                src={enrollment.qr_data_url}
                alt="QR code to add RaftNow to your authenticator app"
                className="mx-auto mb-3 h-44 w-44 rounded-field border border-ink-line bg-white p-2"
              />
              <p className="mb-6 break-all text-center font-mono text-xs text-ink-muted">Setup key: {enrollment.secret}</p>
              <label htmlFor="login-enroll-code" className={labelCls}>
                Authentication code
              </label>
              <input
                id="login-enroll-code"
                name="totp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="123456"
                required
                autoFocus
                value={totp}
                onChange={(e) => setTotp(digits(e.target.value))}
                className={`${inputCls} mb-6 tracking-[0.3em]`}
              />
              <PrimaryButton busy={busy} busyLabel="Verifying…" disabled={totp.length !== 6}>
                Turn on & sign in
              </PrimaryButton>
              <div className="text-center">
                <button type="button" className={linkCls} disabled={busy} onClick={() => switchTo('password')}>
                  Start over
                </button>
              </div>
            </form>
          )}

          {/* Firebase's invisible reCAPTCHA renders here; it must outlive the phone → code step for "Resend". */}
          <div id="login-recaptcha" />
        </div>
      </main>
    </div>
  );
};

export default LoginPage;
