import type { PropertyListingSummary } from '../types';
import { formatPrice, formatSpecsShort } from './format';

/**
 * Exact spec order for the CTA card (block 6, 23-28s): address, specs,
 * price, then a DM-to-tour line. Empty specs/price are omitted rather than
 * rendered as blank lines; `opts.ctaText` only overrides the final line.
 */
export function buildCtaLines(
  listing: PropertyListingSummary,
  opts: { ctaText?: string } = {},
): string[] {
  return [
    listing.address,
    formatSpecsShort(listing),
    formatPrice(listing.price),
    opts.ctaText || "DM 'TOUR' for private showing",
  ].filter(Boolean);
}
