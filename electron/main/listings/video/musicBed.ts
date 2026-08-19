import fs from 'node:fs';
import path from 'node:path';
import type { PriceTier } from './priceTier';

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.ogg']);

/**
 * Picks a track from public/assets/music/{standard|luxury}/ (first match,
 * alphabetically, for determinism). Returns null when the folder is
 * missing/empty/only has non-audio files (e.g. the placeholder README) —
 * callers render silent-except-narration rather than failing.
 */
export function selectMusicTrack(
  tier: PriceTier,
  musicDir: string | null | undefined,
): string | null {
  if (!musicDir) return null;
  const dir = path.join(musicDir, tier);
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const track = entries
    .filter((f) => AUDIO_EXTENSIONS.has(path.extname(f).toLowerCase()))
    .sort()[0];
  return track ? path.join(dir, track) : null;
}
