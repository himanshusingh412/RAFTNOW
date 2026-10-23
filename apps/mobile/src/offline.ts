/**
 * Offline copy of the customer's bookings and tickets (PRD 9: the riverside
 * has weak signal, so a ticket must open without network). Stored as JSON in
 * the app's private documents directory; the QR inside is the server-signed
 * token, so a cached copy is exactly as valid as a fresh one. The cache is
 * display-only: every action (cancel, pay) still goes to the API.
 */
import { File, Paths } from 'expo-file-system';
import type { CustomerBooking, Ticket } from './api';

interface Snapshot {
  phone: string;
  saved_at: string;
  bookings: CustomerBooking[];
  tickets: Record<string, Ticket>;
}

const file = () => new File(Paths.document, 'raftnow-offline-v1.json');

async function read(): Promise<Snapshot | null> {
  try {
    const f = file();
    if (!f.exists) return null;
    return JSON.parse(await f.text()) as Snapshot;
  } catch {
    return null;
  }
}

function write(s: Snapshot) {
  try {
    const f = file();
    if (!f.exists) f.create();
    f.write(JSON.stringify(s));
  } catch {
    // A full disk must never break the online flow.
  }
}

/** Cached data for this phone only, so a shared device never shows someone else's tickets. */
export async function loadOffline(phone: string) {
  const s = await read();
  return s && s.phone === phone ? s : null;
}

export async function saveBookings(phone: string, bookings: CustomerBooking[]) {
  const prev = await loadOffline(phone);
  const keep = new Set(bookings.map((b) => b.id));
  const tickets = Object.fromEntries(Object.entries(prev?.tickets ?? {}).filter(([id]) => keep.has(id)));
  write({ phone, saved_at: new Date().toISOString(), bookings, tickets });
}

export async function saveTicket(phone: string, ticket: Ticket) {
  const prev = await loadOffline(phone);
  write({
    phone,
    saved_at: new Date().toISOString(),
    bookings: prev?.bookings ?? [],
    tickets: { ...(prev?.tickets ?? {}), [ticket.booking_id]: ticket },
  });
}

export function clearOffline() {
  try {
    const f = file();
    if (f.exists) f.delete();
  } catch {
    // ignore
  }
}
