import type { PropertyListingSummary } from '../types';
import type { BucketAssignment, RoomBucket } from './roomBuckets';
import { formatPrice } from './format';

/** Pulls up to `max` distinct feature captions out of the given buckets, in bucket order. */
function pickFeatureLines(
  assignment: BucketAssignment,
  buckets: RoomBucket[],
  max: number,
): string[] {
  const lines: string[] = [];
  for (const bucket of buckets) {
    if (lines.length >= max) break;
    const captioned = (assignment.assignments.get(bucket) ?? []).find(
      (p) => p.caption,
    );
    if (captioned?.caption) lines.push(captioned.caption);
  }
  return lines;
}

/**
 * ~28s spoken script (~65-90 words at ~150-160wpm), formula: Hook + 2 key
 * features + location benefit + CTA. Feature lines prefer real photo
 * captions (kitchen/living/primary) when available, falling back to
 * generic bed/bath/sqft specs so the script never comes up empty.
 */
export function buildReelNarrationScript(
  listing: PropertyListingSummary,
  assignment: BucketAssignment,
  opts: { hookText?: string } = {},
): string {
  const hook =
    opts.hookText || `Just listed in ${listing.city} — this one won't last`;
  const parts = [`${hook}.`];

  const featureLines = pickFeatureLines(
    assignment,
    ['kitchen', 'living', 'primary_bath'],
    2,
  );
  const genericSpecs = [
    listing.beds ? `${listing.beds} bedrooms` : '',
    listing.baths ? `${listing.baths} baths` : '',
    listing.sqft ? `${listing.sqft.toLocaleString()} square feet` : '',
  ]
    .filter(Boolean)
    .join(', ');

  if (featureLines.length >= 2) {
    parts.push(
      `Step inside to a ${featureLines[0].toLowerCase()}, and a ${featureLines[1].toLowerCase()} filled with natural light.`,
    );
  } else if (featureLines.length === 1) {
    parts.push(
      `Step inside to a ${featureLines[0].toLowerCase()}${genericSpecs ? `, with ${genericSpecs}` : ''}.`,
    );
  } else if (genericSpecs) {
    parts.push(`This home offers ${genericSpecs}.`);
  }

  parts.push(
    `Ideally located in ${listing.city}, ${listing.state}, close to everything you need.`,
  );

  const price = formatPrice(listing.price);
  if (price) parts.push(`Offered at ${price}.`);

  parts.push(`DM "TOUR" today to schedule your private showing.`);

  return parts.join(' ');
}
