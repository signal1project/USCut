export type PriceTier = 'standard' | 'luxury';

/** Luxury template kicks in at $600,000 and above. */
export const LUXURY_THRESHOLD_CENTS = 60_000_000;

export function selectPriceTier(
  priceCents: number | null | undefined,
): PriceTier {
  return (priceCents ?? 0) >= LUXURY_THRESHOLD_CENTS ? 'luxury' : 'standard';
}
