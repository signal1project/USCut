import type { PropertyListingSummary } from '../types';

/** `$425,000` under $1M, `$1.25M` at/above — shared by the CTA card, banner, and narration script. */
export function formatPrice(cents: number | null | undefined): string {
  if (!cents) return '';
  const dollars = cents / 100;
  return dollars >= 1_000_000
    ? `$${(dollars / 1_000_000).toFixed(2)}M`
    : `$${dollars.toLocaleString()}`;
}

/** `3 bd · 2 ba · 1,850 sqft`, omitting any spec the listing doesn't have. */
export function formatSpecsShort(
  l: Pick<PropertyListingSummary, 'beds' | 'baths' | 'sqft'>,
): string {
  return [
    l.beds ? `${l.beds} bd` : '',
    l.baths ? `${l.baths} ba` : '',
    l.sqft ? `${l.sqft.toLocaleString()} sqft` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
