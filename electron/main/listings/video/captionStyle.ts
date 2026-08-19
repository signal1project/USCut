import fs from 'node:fs';
import path from 'node:path';
import type { PriceTier } from './priceTier';

export interface ResolvedCaptionStyle {
  /** ASS Fontname — must match the bundled font file's own name-table family record. Undefined falls back to libass's default (Arial). */
  fontFamily?: string;
  color: string;
}

const STANDARD_FONT_FILE = 'Montserrat-Bold.ttf';
const STANDARD_FONT_FAMILY = 'Montserrat';
const STANDARD_COLOR = '#ffffff';

const LUXURY_FONT_FILE = 'PlayfairDisplay-Bold.ttf';
const LUXURY_FONT_FAMILY = 'Playfair Display';
const LUXURY_COLOR = '#d4af37';

/**
 * Resolves the caption font family + color for a price tier. Falls back to
 * no fontFamily (libass default) when the bundled font file isn't present
 * at fontsDir — e.g. a dev checkout that hasn't pulled the asset, or a
 * caller that didn't wire fontsDir up — so captions still render (just in
 * a default font) instead of failing.
 */
export function resolveCaptionStyle(
  tier: PriceTier,
  fontsDir: string | null | undefined,
): ResolvedCaptionStyle {
  const [file, family, color] =
    tier === 'luxury'
      ? [LUXURY_FONT_FILE, LUXURY_FONT_FAMILY, LUXURY_COLOR]
      : [STANDARD_FONT_FILE, STANDARD_FONT_FAMILY, STANDARD_COLOR];
  const available = !!fontsDir && fs.existsSync(path.join(fontsDir, file));
  return { fontFamily: available ? family : undefined, color };
}
