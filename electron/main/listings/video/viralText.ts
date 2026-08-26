import type { PropertyListingSummary } from '../types';
import { formatPrice } from './format';

/**
 * One punchy line per photo for the "Fast-Paced / Viral" template — cycles
 * a short pool of hooks/specs/location/price across the photo sequence
 * instead of one static banner, landing on a CTA line for the last photo
 * (matching the trending "quick cuts + big bold text" reel format). Exported
 * for tests.
 */
export function buildViralTextSequence(
  listing: PropertyListingSummary,
  photoCount: number,
  ctaText?: string,
): string[] {
  if (photoCount <= 0) return [];

  const cityState = [listing.city, listing.state].filter(Boolean).join(', ');
  const specs = [
    listing.beds ? `${listing.beds} BED` : '',
    listing.baths ? `${listing.baths} BATH` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const price = formatPrice(listing.price);
  const cta = ctaText || 'DM us to schedule a showing';

  const pool = ['JUST LISTED', specs, cityState, price].filter(Boolean);
  if (pool.length === 0) pool.push('JUST LISTED');

  return Array.from({ length: photoCount }, (_, i) =>
    i === photoCount - 1 && photoCount > 1 ? cta : pool[i % pool.length],
  );
}
