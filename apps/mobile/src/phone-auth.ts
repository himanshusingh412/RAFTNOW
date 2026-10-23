/**
 * Real phone sign-in for the native app: Firebase Authentication through the
 * native SDK (@react-native-firebase/auth, modular API). The JavaScript
 * Firebase SDK cannot do phone sign-in inside a native app (it needs a browser
 * reCAPTCHA), so the native SDK is required.
 *
 * The native module only exists in builds made with the Firebase config files
 * (see app.config.js: GOOGLE_SERVICES_JSON / GOOGLE_SERVICE_INFO_PLIST). In
 * Expo Go or a build without them, firebaseAuth() returns null and the login
 * screen says phone sign-in is unavailable in this build — it never pretends
 * to send a code.
 */
import { NativeModules, TurboModuleRegistry } from 'react-native';
import type { Auth, ConfirmationResult, User } from '@react-native-firebase/auth';

export type { ConfirmationResult, User as FirebaseUser };

type AuthModule = typeof import('@react-native-firebase/auth');
let mod: AuthModule | null | undefined;

const present = (name: string) => {
  try {
    return !!(TurboModuleRegistry.get(name) ?? (NativeModules as Record<string, unknown>)[name]);
  } catch {
    return false;
  }
};

/** True only in builds that contain React Native Firebase's native code. */
function hasNativeFirebase(): boolean {
  return present('NativeRNFBTurboApp') && present('NativeRNFBTurboAuth');
}

function authModule(): AuthModule | null {
  if (mod === undefined) {
    // Never even load the JS package without its native module: Metro reports a
    // module that fails while loading as a fatal error, which try/catch cannot stop.
    if (!hasNativeFirebase()) {
      mod = null;
      return null;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const m = require('@react-native-firebase/auth') as AuthModule;
      m.getAuth(); // throws if the default Firebase app is not configured
      mod = m;
    } catch {
      mod = null;
    }
  }
  return mod;
}

/** The native Firebase Auth instance, or null when this build has no Firebase. */
export function firebaseAuth(): Auth | null {
  return authModule()?.getAuth() ?? null;
}

/** Sends the SMS code. Calling it again re-sends (Firebase applies its own rate limits). */
export function sendSmsCode(phoneE164: string): Promise<ConfirmationResult> {
  const m = authModule();
  if (!m) throw new Error('Phone sign-in is not available in this build.');
  return m.signInWithPhoneNumber(m.getAuth(), phoneE164);
}

export function idToken(user: User): Promise<string> {
  const m = authModule();
  if (!m) throw new Error('Phone sign-in is not available in this build.');
  return m.getIdToken(user); // refreshed by Firebase when it is about to expire
}

export function onFirebaseUser(cb: (user: User | null) => void): () => void {
  const m = authModule();
  if (!m) return () => undefined;
  return m.onAuthStateChanged(m.getAuth(), cb);
}

export async function firebaseSignOut() {
  const m = authModule();
  if (m && m.getAuth().currentUser) await m.signOut(m.getAuth());
}

/** Resolves once Firebase has restored any persisted user (first auth-state event). */
export function waitForFirebaseUser(): Promise<User | null> {
  return new Promise((resolve) => {
    const unsubscribe = onFirebaseUser((user) => {
      unsubscribe();
      resolve(user);
    });
  });
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
    case 'auth/app-not-authorized':
    case 'auth/missing-client-identifier':
    case 'auth/captcha-check-failed':
    case 'auth/operation-not-allowed':
      return 'Phone sign-in isn’t enabled for this app yet. Please contact RaftNow support.';
    default:
      return 'Phone sign-in failed. Please try again.';
  }
}
