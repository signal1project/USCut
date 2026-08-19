import fs from 'node:fs';
import path from 'node:path';
import { KokoroTTS } from 'kokoro-js';
import { env } from '@huggingface/transformers';

/** Mirrors electron/main/aicuts/audioTools.ts's VoiceoverResult shape. */
export interface VoiceoverResult {
  path: string;
  duration: number;
  name: string;
}

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

/**
 * "Warm, confident" American male voice — see README voice grades: am_fenrir
 * and am_puck grade highest (B/C+) among American male voices, am_michael
 * close behind. Chosen by grade only; a real listening pass (Dale) should
 * confirm/override via the narrationVoice option before this becomes the
 * hard default anyone relies on.
 */
export const DEFAULT_KOKORO_VOICE = 'am_fenrir';

// One model instance per modelCacheDir, reused across calls — loading is
// slow (ONNX graph + weights), so don't repeat it per-video. Keyed by dir
// since that's the only thing that could legitimately vary between callers.
const ttsByCacheDir = new Map<string, Promise<KokoroTTS>>();

function getTTS(modelCacheDir: string): Promise<KokoroTTS> {
  let tts = ttsByCacheDir.get(modelCacheDir);
  if (!tts) {
    fs.mkdirSync(modelCacheDir, { recursive: true });
    env.cacheDir = modelCacheDir;
    tts = KokoroTTS.from_pretrained(MODEL_ID, { dtype: 'q8', device: 'cpu' });
    ttsByCacheDir.set(modelCacheDir, tts);
  }
  return tts;
}

/**
 * Kokoro-82M (Apache-2.0, local/offline) narration → WAV. Resolves null on
 * any failure — offline with no cached model yet, unsupported platform,
 * corrupt cache, etc. — so callers can fall back to SAPI without a special
 * error path, matching the existing best-effort narration convention.
 */
export async function synthesizeNarrationKokoro(
  text: string,
  outDir: string,
  modelCacheDir: string,
  voice: string = DEFAULT_KOKORO_VOICE,
): Promise<VoiceoverResult | null> {
  const clean = text.trim();
  if (!clean) return null;
  try {
    const tts = await getTTS(modelCacheDir);
    const audio = await tts.generate(clean, { voice });
    fs.mkdirSync(outDir, { recursive: true });
    const outWav = path.join(outDir, 'narration-kokoro.wav');
    await audio.save(outWav);
    if (!fs.existsSync(outWav)) return null;
    return {
      path: outWav,
      duration: audio.audio.length / audio.sampling_rate,
      name: `Voiceover: ${clean.slice(0, 32)}${clean.length > 32 ? '…' : ''}`,
    };
  } catch {
    return null;
  }
}
