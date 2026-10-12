// All schedule reasoning happens in IST. IST is a fixed UTC+05:30 with no DST,
// so offset arithmetic is exact and needs no timezone library.

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 86_400_000;
const THURSDAY = 4;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/** Calendar date in IST, `YYYY-MM-DD`. */
export type IsoDate = string;

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseIsoDate(date: IsoDate): { y: number; m: number; d: number } {
  const match = ISO_DATE_RE.exec(date);
  if (!match) throw new Error(`Invalid ISO date: ${date}`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    throw new Error(`Invalid ISO date: ${date}`);
  }
  return { y, m, d };
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

function dateAtUtcMidnight(date: IsoDate): Date {
  const { y, m, d } = parseIsoDate(date);
  return new Date(Date.UTC(y, m - 1, d));
}

function toIsoDate(utcMidnight: Date): IsoDate {
  return `${utcMidnight.getUTCFullYear()}-${pad(utcMidnight.getUTCMonth() + 1)}-${pad(utcMidnight.getUTCDate())}`;
}

export function isIsoDate(value: string): boolean {
  try {
    parseIsoDate(value);
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock parts of an instant as seen in IST. */
export function istParts(at: Date) {
  const shifted = new Date(at.getTime() + IST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

/** IST calendar date of an instant. */
export function istDate(at: Date): IsoDate {
  const p = istParts(at);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** `YYYY-MM-DD HH:mm IST` for logs and UI. */
export function formatIstDateTime(at: Date): string {
  const p = istParts(at);
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)} IST`;
}

/** The UTC instant for an IST wall-clock time on a given IST date. */
export function istToUtc(date: IsoDate, hour = 0, minute = 0, second = 0, ms = 0): Date {
  const { y, m, d } = parseIsoDate(date);
  return new Date(Date.UTC(y, m - 1, d, hour, minute, second, ms) - IST_OFFSET_MS);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return toIsoDate(new Date(dateAtUtcMidnight(date).getTime() + days * DAY_MS));
}

export function weekdayOf(date: IsoDate): number {
  return dateAtUtcMidnight(date).getUTCDay();
}

export function isThursday(date: IsoDate): boolean {
  return weekdayOf(date) === THURSDAY;
}

function assertThursday(issueDate: IsoDate): void {
  if (!isThursday(issueDate)) throw new Error(`Issue date must be a Thursday: ${issueDate}`);
}

/**
 * The issue whose collection window contains `at`: the first Thursday strictly
 * after `at`'s IST date. Thursday 00:00 IST already belongs to next week's issue.
 */
export function collectingIssueDate(at: Date): IsoDate {
  const today = istDate(at);
  const delta = (THURSDAY - weekdayOf(today) + 7) % 7 || 7;
  return addDays(today, delta);
}

/**
 * The issue the review/send jobs act on: the Thursday on or after `at`'s IST date.
 * Wednesday's curate/notify/remind and Thursday morning's send all resolve to the
 * same issue, even though Thursday's articles already feed the next one.
 */
export function targetIssueDate(at: Date): IsoDate {
  const today = istDate(at);
  return addDays(today, (THURSDAY - weekdayOf(today) + 7) % 7);
}

/**
 * Collection window for an issue: previous Thursday 00:00 IST up to and including
 * Wednesday 23:59:59.999 IST. Consecutive windows touch, so no instant is unassigned.
 */
/**
 * Window cutoff: Wednesday 13:30 IST, the start of the last ingest before curate
 * (user decision 2026-10-12). Anything published after it belongs to next week's
 * issue, so Wednesday afternoon and evening news is never lost.
 */
export const WINDOW_CUTOFF = { hour: 13, minute: 30 } as const;

export function issueWindow(issueDate: IsoDate): { start: Date; end: Date } {
  assertThursday(issueDate);
  const start = istToUtc(addDays(issueDate, -8), WINDOW_CUTOFF.hour, WINDOW_CUTOFF.minute);
  const end = new Date(istToUtc(addDays(issueDate, -1), WINDOW_CUTOFF.hour, WINDOW_CUTOFF.minute).getTime() - 1);
  return { start, end };
}

export function isInWindow(at: Date, issueDate: IsoDate): boolean {
  const { start, end } = issueWindow(issueDate);
  const t = at.getTime();
  return t >= start.getTime() && t <= end.getTime();
}

/** The `count` issue dates before `issueDate`, most recent first. */
export function previousIssueDates(issueDate: IsoDate, count: number): IsoDate[] {
  assertThursday(issueDate);
  return Array.from({ length: count }, (_, i) => addDays(issueDate, -7 * (i + 1)));
}

/** `Thu 15 Oct`, as used in email subjects and Telegram headers. */
export function formatIssueDateShort(issueDate: IsoDate): string {
  const { m, d } = parseIsoDate(issueDate);
  return `${WEEKDAYS[weekdayOf(issueDate)]} ${d} ${MONTHS[m - 1]}`;
}

/** The brief's reminder deadline: Wednesday 10 PM IST before the Thursday issue. */
export function reminderDeadline(issueDate: IsoDate): Date {
  return istToUtc(addDays(issueDate, -1), 22, 0);
}
