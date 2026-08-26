import type { BrandKit } from '../../settings/settings';

/**
 * Settings.getActiveBrandKit() is typed as BrandKit but at runtime actually
 * returns a BrandProfile (see settings.ts's getActiveBrandKit/
 * getBrandProfiles) — profiles are created with a `name` field, not
 * `brandName` (that field is only ever populated on the legacy single-kit
 * path, getBrandKit()). Accept either so this reads the name that's
 * actually there in the common case, not just the legacy one.
 */
type BrandKitLike = BrandKit & { name?: string };

/**
 * Text lines for a simple branded intro card (agent/brokerage name, plus a
 * tagline if set) — null when no brand identity is configured, so callers
 * can skip rendering the card entirely rather than showing an empty one.
 */
export function buildBrandIntroLines(kit: BrandKitLike | null): string[] | null {
  const name = kit?.brandName?.trim() || kit?.name?.trim();
  if (!name) return null;
  const lines = [name];
  const tagline = kit?.signature?.trim();
  if (tagline) lines.push(tagline);
  return lines;
}
