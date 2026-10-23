/**
 * Signed-in session for the native app.
 *
 * Stored with expo-secure-store (iOS Keychain / Android Keystore-encrypted
 * storage), readable only while the device is unlocked and never copied to
 * backups or other devices. With Firebase the token itself is held and
 * refreshed by the native Firebase SDK; only the account details are stored
 * here. A developer token (local development servers only) is stored here.
 * Nothing in this file decides access: every token is verified by the API.
 */
import * as SecureStore from 'expo-secure-store';
import { api, ApiError } from './api';
import { firebaseAuth, firebaseSignOut, idToken, waitForFirebaseUser } from './phone-auth';

export type Role = 'customer' | 'operator';

export interface StoredSession {
  kind: 'firebase' | 'dev';
  phone: string;
  role: Role;
  devToken?: string;
}

const KEY = 'raftnow.session.v1';
const STORE_OPTS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export async function saveSession(s: StoredSession) {
  await SecureStore.setItemAsync(KEY, JSON.stringify(s), STORE_OPTS);
}

async function loadSession(): Promise<StoredSession | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY, STORE_OPTS);
    if (!raw) return null;
    const s = JSON.parse(raw) as StoredSession;
    if ((s.kind !== 'firebase' && s.kind !== 'dev') || typeof s.phone !== 'string' || (s.role !== 'customer' && s.role !== 'operator')) return null;
    if (s.kind === 'dev' && typeof s.devToken !== 'string') return null;
    return s;
  } catch {
    return null;
  }
}

/** Signs out everywhere on this device: secure storage and the Firebase SDK. */
export async function endSession() {
  await SecureStore.deleteItemAsync(KEY, STORE_OPTS).catch(() => undefined);
  await firebaseSignOut().catch(() => undefined);
}

/** Where API calls get their bearer token for this session. */
export function tokenProviderFor(s: StoredSession): () => Promise<string | null> {
  if (s.kind === 'dev') return async () => s.devToken ?? null;
  return async () => {
    const user = firebaseAuth()?.currentUser;
    return user ? idToken(user) : null; // refreshed by Firebase when it is about to expire
  };
}

/**
 * Asks the API who this phone identity is: active operator staff (GET
 * /vendor/me succeeds) or a customer. Throws ApiError if the token is rejected.
 */
export async function resolveRole(token: string): Promise<Role> {
  try {
    await api('/vendor/me', { token });
    return 'operator';
  } catch (e) {
    if (e instanceof ApiError && e.status === 401 && /vendor staff/i.test(e.message)) return 'customer';
    throw e;
  }
}

/**
 * On app start: re-verify a stored session with the API. A rejected token
 * ends the session ("expired"); if the API is unreachable the stored session
 * is kept so the app still opens offline, and each screen shows its own error.
 */
export async function restoreSession(): Promise<{ session: StoredSession | null; expired: boolean }> {
  const stored = await loadSession();
  if (!stored) return { session: null, expired: false };
  if (stored.kind === 'firebase') {
    if (!firebaseAuth() || !(await waitForFirebaseUser())) {
      await endSession();
      return { session: null, expired: true };
    }
  }
  const token = await tokenProviderFor(stored)().catch(() => null);
  if (!token) {
    await endSession();
    return { session: null, expired: true };
  }
  try {
    const role = await resolveRole(token);
    const session = { ...stored, role };
    if (role !== stored.role) await saveSession(session);
    return { session, expired: false };
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      await endSession();
      return { session: null, expired: true };
    }
    return { session: stored, expired: false };
  }
}
