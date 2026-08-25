import type { PropertyListingSummary } from '../types';
import { formatPrice, formatSpecsShort } from './format';

/**
 * Exact spec order for the CTA card (block 6, 23-28s): city/state, specs,
 * price, then a DM-to-tour line. No street address — public-facing output
 * only ever shows city/state. Empty specs/price are omitted rather than
 * rendered as blank lines; `opts.ctaText` only overrides the final line.
 */
export function buildCtaLines(
  listing: PropertyListingSummary,
  opts: { ctaText?: string } = {},
): string[] {
  const cityState = [listing.city, listing.state].filter(Boolean).join(', ');
  return [
    cityState,
    formatSpecsShort(listing),
    formatPrice(listing.price),
    opts.ctaText || "DM 'TOUR' for private showing",
  ].filter(Boolean);
}
