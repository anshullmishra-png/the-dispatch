// Next run of each cron job, computed from vercel.json so it can't drift from
// the real schedule. Supports the subset we use: numbers, ranges, lists, "*".
import vercel from "@/vercel.json";

function field(spec: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    if (part === "*") for (let i = min; i <= max; i += 1) out.add(i);
    else if (part.includes("-")) {
      const [a, b] = part.split("-").map(Number) as [number, number];
      for (let i = a; i <= b; i += 1) out.add(i);
    } else out.add(Number(part));
  }
  return out;
}

/** First UTC minute at or after `from` matching a 5-field cron expression (UTC, as Vercel runs them). */
export function nextCronRun(expr: string, from: Date): Date {
  const [mi, h, dom, mon, dow] = expr.trim().split(/\s+/) as [string, string, string, string, string];
  const minutes = field(mi, 0, 59);
  const hours = field(h, 0, 23);
  const days = field(dom, 1, 31);
  const months = field(mon, 1, 12);
  const weekdays = field(dow, 0, 6);
  const t = new Date(from);
  t.setUTCSeconds(0, 0);
  if (t < from) t.setUTCMinutes(t.getUTCMinutes() + 1);
  for (let i = 0; i < 60 * 24 * 370; i += 1) {
    if (
      minutes.has(t.getUTCMinutes()) &&
      hours.has(t.getUTCHours()) &&
      days.has(t.getUTCDate()) &&
      months.has(t.getUTCMonth() + 1) &&
      weekdays.has(t.getUTCDay())
    ) {
      return t;
    }
    t.setUTCMinutes(t.getUTCMinutes() + 1);
  }
  throw new Error(`no run within a year for "${expr}"`);
}

export interface ScheduledJob {
  job: string;
  schedule: string;
  next: Date;
}

export function upcomingJobs(now: Date): ScheduledJob[] {
  return vercel.crons
    .map((c) => ({ job: c.path.split("/").pop() as string, schedule: c.schedule, next: nextCronRun(c.schedule, now) }))
    .sort((a, b) => a.next.getTime() - b.next.getTime());
}
