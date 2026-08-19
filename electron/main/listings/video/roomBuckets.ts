export type RoomBucket =
  | 'hook'
  | 'kitchen'
  | 'living'
  | 'primary_bath'
  | 'money_shot';

export interface BucketSpec {
  bucket: RoomBucket;
  /** On-screen kinetic text for this block. Empty string = resolved per-listing (hook, money_shot). */
  label: string;
  startSec: number;
  endSec: number;
  minPhotos: number;
  maxPhotos: number;
}

/**
 * Matches the client reel-spec timing exactly. A 6th block, the CTA card
 * (23-28s), is not a photo bucket — it's built separately by ctaCard.ts /
 * reelTimeline.ts. Total: 28s, inside the 25-30s target.
 */
export const REEL_BUCKET_PLAN: BucketSpec[] = [
  {
    bucket: 'hook',
    label: '',
    startSec: 0,
    endSec: 3,
    minPhotos: 1,
    maxPhotos: 1,
  },
  {
    bucket: 'kitchen',
    label: 'Kitchen',
    startSec: 3,
    endSec: 8,
    minPhotos: 1,
    maxPhotos: 2,
  },
  {
    bucket: 'living',
    label: 'Natural Light / Open Concept',
    startSec: 8,
    endSec: 13,
    minPhotos: 1,
    maxPhotos: 2,
  },
  {
    bucket: 'primary_bath',
    label: 'Primary Suite',
    startSec: 13,
    endSec: 18,
    minPhotos: 1,
    maxPhotos: 2,
  },
  {
    bucket: 'money_shot',
    label: '',
    startSec: 18,
    endSec: 23,
    minPhotos: 1,
    maxPhotos: 1,
  },
];

const KITCHEN_RE = /\bkitchen\b/i;
const LIVING_RE = /\b(living\s*room|great\s*room|family\s*room|open\s*concept|dining\s*room)\b/i;
const PRIMARY_BATH_RE = /\b(bed\s*room|bedroom|bath\s*room|bathroom|en\s*-?\s*suite|master|primary\s*suite)\b/i;
const MONEY_SHOT_RE =
  /\bacre\w*\b|\bback\s*yard\b|\bdeck\b|\bpatio\b|\bgarage\b|\bpool\b|\byard\b|\bview\b|\boutdoor\s*living\b|\blot\b/i;
const HOOK_RE = /\b(exterior|front\s*(of\s*(the\s*)?)?(house|home)?|curb\s*appeal|facade|façade|welcome\s*home)\b/i;

/**
 * Keyword heuristic over a photo's caption text. No AI, no I/O — a starting
 * point to refine once real Zillow caption data has been observed (exact
 * caption field is unconfirmed — see zillow.ts).
 */
export function classifyPhotoCaption(
  caption: string | null | undefined,
): RoomBucket | null {
  const c = caption?.trim();
  if (!c) return null;
  if (KITCHEN_RE.test(c)) return 'kitchen';
  if (LIVING_RE.test(c)) return 'living';
  if (PRIMARY_BATH_RE.test(c)) return 'primary_bath';
  if (MONEY_SHOT_RE.test(c)) return 'money_shot';
  if (HOOK_RE.test(c)) return 'hook';
  return null;
}

export interface ClassifiedPhoto {
  url: string;
  caption: string | null;
  bucket: RoomBucket | null;
}

export interface BucketAssignment {
  plan: BucketSpec[];
  assignments: Map<RoomBucket, ClassifiedPhoto[]>;
}

/**
 * Assigns every candidate photo to one of the 6-block buckets:
 *  1. Photos whose caption classifies cleanly go to that bucket first (up to
 *     its maxPhotos).
 *  2. Remaining bucket slots (down to minPhotos) fill positionally from
 *     whatever's left, in original order. `hook` gets first pick of
 *     whatever's left when still empty — the first unclassified photo on a
 *     real estate listing is very reliably the exterior/hero shot.
 *  3. Never throws, never assumes a bucket is non-empty — a listing with
 *     fewer photos than buckets just leaves later buckets (in
 *     REEL_BUCKET_PLAN order) empty; callers must handle that.
 */
export function assignPhotoBuckets(
  photos: Array<{ url: string; caption?: string | null }>,
  opts: { photoOrder?: number[] } = {},
): BucketAssignment {
  const ordered = opts.photoOrder
    ? opts.photoOrder
        .map((i) => photos[i])
        .filter((p): p is { url: string; caption?: string | null } => !!p)
    : photos;

  const remaining: ClassifiedPhoto[] = ordered.map((p) => ({
    url: p.url,
    caption: p.caption ?? null,
    bucket: classifyPhotoCaption(p.caption),
  }));

  const assignments = new Map<RoomBucket, ClassifiedPhoto[]>(
    REEL_BUCKET_PLAN.map((b) => [b.bucket, []]),
  );

  // Pass 1: honor explicit caption classification.
  for (const spec of REEL_BUCKET_PLAN) {
    const bucketList = assignments.get(spec.bucket)!;
    for (let i = 0; i < remaining.length && bucketList.length < spec.maxPhotos; ) {
      if (remaining[i].bucket === spec.bucket) {
        bucketList.push(remaining[i]);
        remaining.splice(i, 1);
      } else {
        i++;
      }
    }
  }

  // Pass 2a: hook gets first pick of whatever's left, if still empty.
  const hookList = assignments.get('hook')!;
  if (hookList.length === 0 && remaining.length > 0) {
    hookList.push(remaining.shift()!);
  }

  // Pass 2b: positional fill down to each bucket's minimum first, so a
  // handful of leftover photos spread across all 5 room types (coverage)
  // rather than piling into whichever bucket comes first in plan order.
  for (const spec of REEL_BUCKET_PLAN) {
    const bucketList = assignments.get(spec.bucket)!;
    while (bucketList.length < spec.minPhotos && remaining.length > 0) {
      bucketList.push(remaining.shift()!);
    }
  }

  // Pass 2c: only once every bucket has its minimum, top up further toward
  // each bucket's maximum with whatever's still left, so an abundance of
  // uncaptioned photos gets used instead of silently dropped.
  for (const spec of REEL_BUCKET_PLAN) {
    const bucketList = assignments.get(spec.bucket)!;
    while (bucketList.length < spec.maxPhotos && remaining.length > 0) {
      bucketList.push(remaining.shift()!);
    }
  }

  return { plan: REEL_BUCKET_PLAN, assignments };
}

const MONEY_SHOT_FALLBACK_LABEL = 'Outdoor Living';

/**
 * Best-feature label for the money-shot block: the photo's own caption when
 * classification found one, else a generic fallback. Revisit once real
 * caption data shows what's actually available to pick from.
 */
export function resolveMoneyShotLabel(assignment: BucketAssignment): string {
  const photos = assignment.assignments.get('money_shot') ?? [];
  const captioned = photos.find((p) => p.caption);
  return captioned?.caption ?? MONEY_SHOT_FALLBACK_LABEL;
}
