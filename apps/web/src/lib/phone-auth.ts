/**
 * Phone sign-in for customers and operator staff.
 *
 *  - Firebase phone OTP when VITE_FIREBASE_* config is present (production path).
 *  - Developer sign-in ONLY when the API reports firebase_auth = "dev_bypass_only"
 *    (AUTH_DEV_BYPASS=true on a non-production server). It mints a
 *    "dev:<uid>:<phone>" token which the API rejects in production.
 *
 * Tokens are kept in memory + sessionStorage (cleared when the tab closes).
 */
import type { ConfirmationResult, Auth, RecaptchaVerifier } from 'firebase/auth';

export type Audience = 'customer' | 'vendor';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

export const firebaseConfigured = !!(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId);

let authPromise: Promise<Auth> | null = null;
async function firebaseAuth(): Promise<Auth> {
  if (!firebaseConfigured) throw new Error('Firebase is not configured for this web app');
  authPromise ??= (async () => {
    const { initializeApp } = await import('firebase/app');
    const { getAuth } = await import('firebase/auth');
    return getAuth(initializeApp(firebaseConfig as Record<string, string>));
  })();
  return authPromise;
}

const storageKey = (a: Audience) => `raftnow.${a}.devtoken`;

export function getDevToken(a: Audience): string | null {
  try {
    return sessionStorage.getItem(storageKey(a));
  } catch {
    return null;
  }
}

export function setDevToken(a: Audience, uid: string, phone: string) {
  const token = `dev:${uid}:${phone}`;
  try {
    sessionStorage.setItem(storageKey(a), token);
  } catch {
    /* storage unavailable — token lives for this page only */
  }
  memoryTokens[a] = token;
  return token;
}

const memoryTokens: Partial<Record<Audience, string>> = {};

let verifier: RecaptchaVerifier | null = null;
function clearVerifier() {
  try {
    verifier?.clear();
  } catch {
    /* container already gone */
  }
  verifier = null;
}

/**
 * Sends a one-time code by SMS (Firebase, invisible reCAPTCHA). Safe to call
 * again for "resend": the previous reCAPTCHA widget is cleared first, because
 * Firebase refuses to render a second one into the same element.
 */
export async function sendOtp(phoneE164: string, recaptchaContainerId: string): Promise<ConfirmationResult> {
  const auth = await firebaseAuth();
  const { RecaptchaVerifier: Verifier, signInWithPhoneNumber } = await import('firebase/auth');
  clearVerifier();
  verifier = new Verifier(auth, recaptchaContainerId, { size: 'invisible' });
  try {
    return await signInWithPhoneNumber(auth, phoneE164, verifier);
  } catch (e) {
    clearVerifier();
    throw e;
  }
}

/** Human-readable message for a Firebase phone-auth error, or null if it is not one. */
export function phoneAuthErrorMessage(err: unknown): string | null {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code !== 'string' || !code.startsWith('auth/')) return null;
  switch (code) {
    case 'auth/invalid-phone-number':
    case 'auth/missing-phone-number':
      return 'That phone number doesn’t look right. Check it and try again.';
    case 'auth/invalid-verification-code':
    case 'auth/missing-verification-code':
      return 'That code didn’t match. Check the SMS and try again.';
    case 'auth/code-expired':
    case 'auth/session-expired':
      return 'That code has expired. Request a new one.';
    case 'auth/too-many-requests':
    case 'auth/quota-exceeded':
      return 'Too many attempts. Please wait a few minutes and try again.';
    case 'auth/network-request-failed':
      return 'Can’t reach the sign-in service. Check your connection and try again.';
    case 'auth/captcha-check-failed':
      return 'Security check failed. Reload the page and try again.';
    case 'auth/operation-not-allowed':
    case 'auth/unauthorized-domain':
    case 'auth/invalid-api-key':
    case 'auth/app-not-authorized':
      return 'Phone sign-in isn’t enabled for this site. Please contact RaftNow support.';
    default:
      return 'Phone sign-in failed. Please try again.';
  }
}

/** Returns a bearer token for the audience, or null when signed out. */
export async function getToken(a: Audience): Promise<string | null> {
  const dev = memoryTokens[a] ?? getDevToken(a);
  if (dev) return dev;
  if (!firebaseConfigured) return null;
  const auth = await firebaseAuth();
  // Wait for Firebase to restore a persisted session; currentUser is null until then.
  await auth.authStateReady();
  return auth.currentUser ? auth.currentUser.getIdToken() : null;
}

export async function signOut(a: Audience) {
  delete memoryTokens[a];
  try {
    sessionStorage.removeItem(storageKey(a));
  } catch {
    /* ignore */
  }
  if (firebaseConfigured) {
    const auth = await firebaseAuth();
    const { signOut: fbSignOut } = await import('firebase/auth');
    await fbSignOut(auth);
  }
}
