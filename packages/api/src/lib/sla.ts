/**
 * SLA computation library — pure functions.
 *
 * The SLA "clock" is a virtual timeline that only advances during business
 * hours (if the policy says so) and only when the ticket is being actively
 * worked (not when waiting on customer reply, if pause_on_pending = true).
 *
 * These functions are used by:
 *   - Ticket-create / accept handlers: to compute the initial sla_due_at
 *   - PATCH /tickets/:id status transitions: to pause/resume the clock
 *   - The SLA worker (modules/ticketing/src/index.ts): to figure out the
 *     elapsed percentage for reminder + escalation firing.
 *
 * Defaults (per user-approved spec, 2026-06-24):
 *   - Business hours timezone: tenant's settings.timezone (UTC fallback)
 *   - Default schedule when business_hours_only = false: 24/7 (no filter)
 *   - Pause granularity: immediate (the moment status changes)
 */

type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
const DAY_KEYS: DayKey[] = ['mon','tue','wed','thu','fri','sat','sun'];

export interface BusinessDay {
  enabled: boolean;
  /** "HH:MM" 24-hour */
  start: string;
  /** "HH:MM" 24-hour */
  end: string;
}

export type BusinessHoursSchedule = Partial<Record<DayKey, BusinessDay>>;

/** Convert "HH:MM" → minutes-since-midnight (0..1440). */
function hhmmToMinutes(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return 0;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/** Day-of-week index 0..6 (mon=0) for a Date in a given IANA timezone. */
function dayKey(d: Date, tz: string): DayKey {
  // toLocaleString with the weekday — Intl handles tz conversion.
  const w = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz }).format(d).toLowerCase();
  // mon, tue, wed, thu, fri, sat, sun (first 3 chars)
  return w.slice(0, 3) as DayKey;
}

/** Hour:minute (in the given tz) → minutes-since-midnight. */
function localMinutes(d: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const h = parseInt(parts.find(p => p.type === 'hour')!.value, 10);
  const m = parseInt(parts.find(p => p.type === 'minute')!.value, 10);
  return h * 60 + m;
}

/** Reset a Date to the start of its local-tz day (00:00). */
function startOfLocalDay(d: Date, tz: string): Date {
  const dateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d); // "2026-06-24"
  // Reconstruct a Date for that local-midnight in the target tz.
  return new Date(`${dateStr}T00:00:00${tzOffsetSuffix(tz, d)}`);
}

/** Returns "+05:00" / "-04:00" / "Z" for the tz at a given moment. */
function tzOffsetSuffix(tz: string, ref: Date): string {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, timeZoneName: 'shortOffset',
  });
  const parts = fmt.formatToParts(ref);
  const off = parts.find(p => p.type === 'timeZoneName')?.value ?? 'GMT';
  // "GMT+5" / "GMT-04:00" / "GMT"
  if (off === 'GMT') return 'Z';
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(off);
  if (!m) return 'Z';
  const sign = m[1];
  const hh = m[2].padStart(2, '0');
  const mm = (m[3] ?? '00').padStart(2, '0');
  return `${sign}${hh}:${mm}`;
}

/**
 * Default to 24/7 (no business-hours restriction) when:
 *   - schedule is null/undefined
 *   - business_hours_only is false
 * Otherwise, returns the schedule as-is. Missing days default to disabled.
 */
function effectiveSchedule(
  businessHoursOnly: boolean,
  schedule: BusinessHoursSchedule | null | undefined,
): BusinessHoursSchedule | null {
  if (!businessHoursOnly) return null; // 24/7
  if (!schedule || typeof schedule !== 'object') {
    // business_hours_only = true but no schedule configured → fall back to
    // Mon–Fri 09:00–18:00 so the system never silently degrades to "0 hours/day".
    return {
      mon: { enabled: true, start: '09:00', end: '18:00' },
      tue: { enabled: true, start: '09:00', end: '18:00' },
      wed: { enabled: true, start: '09:00', end: '18:00' },
      thu: { enabled: true, start: '09:00', end: '18:00' },
      fri: { enabled: true, start: '09:00', end: '18:00' },
      sat: { enabled: false, start: '09:00', end: '18:00' },
      sun: { enabled: false, start: '09:00', end: '18:00' },
    };
  }
  return schedule;
}

const MS_PER_HOUR = 3_600_000;
const MS_PER_MIN  = 60_000;
const MAX_DAYS_WALK = 365; // safety cap; no SLA realistically spans > 1 year

/**
 * Walk forward by N business-hours from `start` and return the resulting
 * wall-clock timestamp. If `schedule` is null, treats all time as business
 * time (so the result is just start + hours * 60min).
 */
export function addBusinessHours(
  start: Date,
  hours: number,
  businessHoursOnly: boolean,
  schedule: BusinessHoursSchedule | null | undefined,
  tz: string,
): Date {
  const sched = effectiveSchedule(businessHoursOnly, schedule);
  if (!sched) {
    // 24/7
    return new Date(start.getTime() + hours * MS_PER_HOUR);
  }

  let remainingMs = hours * MS_PER_HOUR;
  let cursor = new Date(start);

  for (let safety = 0; safety < MAX_DAYS_WALK && remainingMs > 0; safety++) {
    const dk = dayKey(cursor, tz);
    const day = sched[dk];
    if (!day || !day.enabled) {
      // Skip to start of next day
      const next = new Date(startOfLocalDay(cursor, tz).getTime() + 24 * MS_PER_HOUR);
      cursor = next;
      continue;
    }

    const dayStartMin = hhmmToMinutes(day.start);
    const dayEndMin   = hhmmToMinutes(day.end);
    const nowMin      = localMinutes(cursor, tz);

    // Before business hours → jump to start of business hours today
    if (nowMin < dayStartMin) {
      cursor = new Date(startOfLocalDay(cursor, tz).getTime() + dayStartMin * MS_PER_MIN);
      continue;
    }
    // After business hours → jump to start of next day
    if (nowMin >= dayEndMin) {
      cursor = new Date(startOfLocalDay(cursor, tz).getTime() + 24 * MS_PER_HOUR);
      continue;
    }

    // We're inside business hours. Take min(remainingMs, time-until-day-end).
    const msUntilEnd = (dayEndMin - nowMin) * MS_PER_MIN;
    const consume = Math.min(remainingMs, msUntilEnd);
    cursor = new Date(cursor.getTime() + consume);
    remainingMs -= consume;
  }

  return cursor;
}

/**
 * Returns the milliseconds of business-hours time between `from` and `to`.
 * When schedule is null (24/7), this is just `to - from`.
 */
export function elapsedBusinessMs(
  from: Date,
  to: Date,
  businessHoursOnly: boolean,
  schedule: BusinessHoursSchedule | null | undefined,
  tz: string,
): number {
  if (to.getTime() <= from.getTime()) return 0;
  const sched = effectiveSchedule(businessHoursOnly, schedule);
  if (!sched) return to.getTime() - from.getTime();

  let cursor = new Date(from);
  let acc = 0;

  for (let safety = 0; safety < MAX_DAYS_WALK && cursor.getTime() < to.getTime(); safety++) {
    const dk  = dayKey(cursor, tz);
    const day = sched[dk];
    if (!day || !day.enabled) {
      cursor = new Date(startOfLocalDay(cursor, tz).getTime() + 24 * MS_PER_HOUR);
      continue;
    }

    const dayStartMin = hhmmToMinutes(day.start);
    const dayEndMin   = hhmmToMinutes(day.end);
    const nowMin      = localMinutes(cursor, tz);

    if (nowMin < dayStartMin) {
      cursor = new Date(startOfLocalDay(cursor, tz).getTime() + dayStartMin * MS_PER_MIN);
      continue;
    }
    if (nowMin >= dayEndMin) {
      cursor = new Date(startOfLocalDay(cursor, tz).getTime() + 24 * MS_PER_HOUR);
      continue;
    }

    const dayEndAbsMs = startOfLocalDay(cursor, tz).getTime() + dayEndMin * MS_PER_MIN;
    const segmentEnd = Math.min(dayEndAbsMs, to.getTime());
    acc += segmentEnd - cursor.getTime();
    cursor = new Date(segmentEnd);
  }

  return acc;
}

/**
 * Total milliseconds the ticket has been *paused*, including the live pause
 * if it's currently in 'pending' status.
 */
export function totalPausedMs(ticket: {
  sla_paused_at: Date | string | null;
  sla_paused_total_ms: number | string | null;
}, nowMs: number): number {
  const banked = Number(ticket.sla_paused_total_ms ?? 0);
  if (!ticket.sla_paused_at) return banked;
  const pausedAtMs = new Date(ticket.sla_paused_at).getTime();
  return banked + Math.max(0, nowMs - pausedAtMs);
}

/**
 * The elapsed percentage of the SLA budget. Used by the worker to decide
 * if reminders / escalations should fire.
 *
 * elapsedPct = (businessHoursElapsed - paused) / totalBudget * 100
 *
 * Note: totalBudget is `resolution_hours` worth of business-hours time.
 */
export function computeElapsedPct(
  ticket: {
    accepted_at: Date | string;
    sla_paused_at: Date | string | null;
    sla_paused_total_ms: number | string | null;
  },
  policy: {
    resolution_hours: number;
    business_hours_only?: boolean | null;
    business_hours_schedule?: BusinessHoursSchedule | null;
    pause_on_pending?: boolean | null;
  },
  tz: string,
  nowMs: number = Date.now(),
): number {
  const accepted = new Date(ticket.accepted_at);
  const bho      = !!policy.business_hours_only;
  const sched    = policy.business_hours_schedule ?? null;

  const budgetMs = policy.resolution_hours * MS_PER_HOUR; // budget is wall-clock hours of business time
  if (budgetMs <= 0) return 0;

  // How much business-hours time has actually passed?
  const businessElapsed = elapsedBusinessMs(accepted, new Date(nowMs), bho, sched, tz);

  // Subtract the paused time IF the policy enables pause-on-pending.
  const paused = policy.pause_on_pending ? totalPausedMs(ticket, nowMs) : 0;

  const effectiveElapsed = Math.max(0, businessElapsed - paused);
  return (effectiveElapsed / budgetMs) * 100;
}

/**
 * Given a ticket that just got accepted, compute its sla_due_at — the
 * wall-clock timestamp it should be resolved by, respecting business hours.
 *
 * Use this at POST /tickets and POST /tickets/:id/accept.
 */
export function computeSlaDueAt(
  acceptedAt: Date,
  policy: {
    resolution_hours: number;
    business_hours_only?: boolean | null;
    business_hours_schedule?: BusinessHoursSchedule | null;
  },
  tz: string,
): Date {
  return addBusinessHours(
    acceptedAt,
    policy.resolution_hours,
    !!policy.business_hours_only,
    policy.business_hours_schedule ?? null,
    tz,
  );
}
