import type { AIProvider } from '@mas/types';
import type { TranscriptSegment } from './transcription';

export interface HighlightWindow {
  start: number;
  end: number;
  /** Why this moment was picked / suggested caption hook. */
  hook: string;
}

export interface PickOptions {
  maxClips: number;
  /** Target clip length in seconds. */
  clipSeconds: number;
}

/**
 * Heuristic highlight scoring (no AI needed): rewards questions, exclamations,
 * numbers, and hook words that historically stop the scroll. Exported for
 * tests and used as the fallback when no AI provider is configured.
 */
export function scoreSegment(text: string): number {
  let score = 0;
  if (/\?/.test(text)) score += 2;
  if (/!/.test(text)) score += 1;
  if (/\d/.test(text)) score += 2;
  if (
    /\b(how|why|what|secret|mistake|never|always|top|best|worst|free|stop|before you)\b/i.test(
      text,
    )
  )
    score += 3;
  if (/\b(you|your)\b/i.test(text)) score += 1;
  const words = text.split(/\s+/).length;
  if (words >= 8 && words <= 40) score += 1;
  return score;
}

/** Grow a window around a seed segment until it reaches the target length. */
function windowAround(
  segments: TranscriptSegment[],
  seedIdx: number,
  clipSeconds: number,
): { start: number; end: number } {
  let lo = seedIdx;
  let hi = seedIdx;
  const len = (): number => segments[hi].end - segments[lo].start;
  while (len() < clipSeconds && (lo > 0 || hi < segments.length - 1)) {
    const canDown = lo > 0;
    const canUp = hi < segments.length - 1;
    if (canUp && (!canDown || hi - seedIdx <= seedIdx - lo)) hi += 1;
    else if (canDown) lo -= 1;
    else break;
  }
  return { start: segments[lo].start, end: segments[hi].end };
}

/** Rule-based fallback picker. Exported for tests. */
export function pickHighlightsHeuristic(
  segments: TranscriptSegment[],
  opts: PickOptions,
): HighlightWindow[] {
  if (segments.length === 0) return [];
  const scored = segments
    .map((seg, i) => ({ i, seg, score: scoreSegment(seg.text) }))
    .sort((a, b) => b.score - a.score);

  const picked: HighlightWindow[] = [];
  for (const { i, seg } of scored) {
    if (picked.length >= opts.maxClips) break;
    const win = windowAround(segments, i, opts.clipSeconds);
    // No overlaps with already-picked windows.
    if (picked.some((p) => win.start < p.end && p.start < win.end)) continue;
    picked.push({ ...win, hook: seg.text.slice(0, 120) });
  }
  return picked.sort((a, b) => a.start - b.start);
}

/**
 * AI highlight picker: hands the timestamped transcript to the active provider
 * and asks for the strongest short-form moments. Falls back to the heuristic
 * on any parse/provider failure.
 */
export async function pickHighlights(
  segments: TranscriptSegment[],
  opts: PickOptions,
  provider?: AIProvider | null,
): Promise<{ windows: HighlightWindow[]; pickedBy: 'ai' | 'heuristic' }> {
  if (!provider || segments.length === 0) {
    return {
      windows: pickHighlightsHeuristic(segments, opts),
      pickedBy: 'heuristic',
    };
  }

  const transcriptText = segments
    .map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`)
    .join('\n')
    .slice(0, 24_000);

  const prompt = `You are a short-form video editor. Below is a timestamped transcript.
Pick the ${opts.maxClips} strongest self-contained moments for viral vertical clips
(~${opts.clipSeconds}s each). Moments must not overlap.

TRANSCRIPT:
${transcriptText}

Respond with ONLY a JSON array: [{"start": seconds, "end": seconds, "hook": "one-line caption hook"}]`;

  try {
    const raw = await provider.generateText(prompt, {});
    const jsonStart = raw.search(/\[/);
    if (jsonStart === -1) throw new Error('no_json');
    const parsed = JSON.parse(
      raw.slice(jsonStart, raw.lastIndexOf(']') + 1),
    ) as Array<{
      start: number;
      end: number;
      hook?: string;
    }>;
    const maxEnd = segments[segments.length - 1].end;
    const windows = parsed
      .filter(
        (w) =>
          Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start,
      )
      .map((w) => ({
        start: Math.max(0, w.start),
        end: Math.min(maxEnd, w.end),
        hook: String(w.hook ?? '').slice(0, 120),
      }))
      .slice(0, opts.maxClips)
      .sort((a, b) => a.start - b.start);
    if (windows.length === 0) throw new Error('empty');
    return { windows, pickedBy: 'ai' };
  } catch {
    return {
      windows: pickHighlightsHeuristic(segments, opts),
      pickedBy: 'heuristic',
    };
  }
}
