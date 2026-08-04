/**
 * Best-time-to-post: aggregates the user's own publish history + analytics
 * snapshots into (day-of-week, hour) engagement buckets and ranks them.
 * Pure functions — the TypeORM wiring lives in insightsService.ts.
 */

export interface PostPerformance {
  publishedAt: Date;
  engagements: number;
}

export interface BestTimeSlot {
  /** 0 = Sunday … 6 = Saturday (local time). */
  dayOfWeek: number;
  /** 0–23 local hour. */
  hour: number;
  avgEngagements: number;
  sampleSize: number;
}

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export function slotLabel(slot: BestTimeSlot): string {
  const h = slot.hour % 12 === 0 ? 12 : slot.hour % 12;
  const ampm = slot.hour < 12 ? 'AM' : 'PM';
  return `${DAY_NAMES[slot.dayOfWeek]} ${h}:00 ${ampm}`;
}

/** Rank (dow, hour) buckets by average engagement. Requires >=1 sample per bucket. */
export function computeBestTimes(
  posts: PostPerformance[],
  top = 5,
): BestTimeSlot[] {
  const buckets = new Map<
    string,
    { total: number; n: number; dow: number; hour: number }
  >();
  for (const p of posts) {
    const d = p.publishedAt;
    const dow = d.getDay();
    const hour = d.getHours();
    const key = `${dow}:${hour}`;
    const b = buckets.get(key) ?? { total: 0, n: 0, dow, hour };
    b.total += p.engagements;
    b.n += 1;
    buckets.set(key, b);
  }
  return [...buckets.values()]
    .map((b) => ({
      dayOfWeek: b.dow,
      hour: b.hour,
      avgEngagements: Math.round((b.total / b.n) * 100) / 100,
      sampleSize: b.n,
    }))
    .sort(
      (a, b) =>
        b.avgEngagements - a.avgEngagements || b.sampleSize - a.sampleSize,
    )
    .slice(0, top);
}

/**
 * Next occurrence of a slot after `from` (local time), at least `minLeadMinutes`
 * out so the scheduler never lands in the past.
 */
export function nextOccurrence(
  slot: BestTimeSlot,
  from = new Date(),
  minLeadMinutes = 10,
): Date {
  const candidate = new Date(from);
  candidate.setMinutes(0, 0, 0);
  candidate.setHours(slot.hour);
  const dayDelta = (slot.dayOfWeek - candidate.getDay() + 7) % 7;
  candidate.setDate(candidate.getDate() + dayDelta);
  if (candidate.getTime() < from.getTime() + minLeadMinutes * 60_000) {
    candidate.setDate(candidate.getDate() + 7);
  }
  return candidate;
}

/**
 * Parse algorithm-playbook fallback times like "Weekdays 11AM–1PM" is not
 * machine-usable, so fallback slots are generic engagement-peak defaults
 * used when the user has no publish history yet.
 */
export const DEFAULT_SLOTS: BestTimeSlot[] = [
  { dayOfWeek: 2, hour: 11, avgEngagements: 0, sampleSize: 0 }, // Tue 11am
  { dayOfWeek: 4, hour: 12, avgEngagements: 0, sampleSize: 0 }, // Thu noon
  { dayOfWeek: 3, hour: 18, avgEngagements: 0, sampleSize: 0 }, // Wed 6pm
  { dayOfWeek: 6, hour: 10, avgEngagements: 0, sampleSize: 0 }, // Sat 10am
  { dayOfWeek: 0, hour: 19, avgEngagements: 0, sampleSize: 0 }, // Sun 7pm
];
