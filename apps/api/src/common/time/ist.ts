/**
 * Rishikesh operates on India Standard Time (UTC+05:30, no DST). All instants
 * are stored in UTC; IST is used only to interpret calendar dates and
 * "HH:MM" departure templates.
 */
export const IST_OFFSET = '+05:30';
export const IST_TZ = 'Asia/Kolkata';
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

/** [start, end) of an IST calendar day, as UTC instants. */
export function istDayRange(date: string): { start: Date; end: Date } {
  const start = new Date(`${date}T00:00:00${IST_OFFSET}`);
  return { start, end: new Date(start.getTime() + 24 * 3600 * 1000) };
}

/** The IST calendar date (YYYY-MM-DD) of a UTC instant. */
export function istDateOf(instant: Date): string {
  return new Date(instant.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Day of week (0 = Sunday) of an IST calendar date. */
export function istWeekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** UTC instant for "HH:MM" on an IST calendar date. */
export function istDateTime(date: string, hhmm: string): Date {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm)) throw new Error(`Invalid HH:MM time "${hhmm}"`);
  return new Date(`${date}T${hhmm}:00${IST_OFFSET}`);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
