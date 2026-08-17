import type { AIProvider, AnalyzeFramesInput } from '@mas/types';
import type { TranscriptSegment } from './transcription';

export interface HighlightWindow {
  start: number;
  end: number;
  /** Why this moment was picked / suggested caption hook. */
  hook: string;
  /** 0-100 — how strong a standalone clip this moment makes. */
  score: number;
}

export interface PickOptions {
  maxClips: number;
  /** Target clip length in seconds. */
  clipSeconds: number;
  /**
   * Natural-language filter, e.g. "find the funny moments" or "anything
   * about pricing". The AI path treats this as a real semantic filter; the
   * heuristic fallback only does a best-effort keyword-overlap boost — it
   * has no actual language understanding.
   */
  query?: string;
}

/**
 * Heuristic highlight scoring (no AI needed): rewards questions, exclamations,
 * numbers, and hook words that historically stop the scroll. Exported for
 * tests and used as the fallback when no AI provider is configured.
 * Max raw score is 10 — see normalizeHeuristicScore() for the 0-100 scale
 * surfaced on HighlightWindow.
 */
export function scoreSegment(text: string, query?: string): number {
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
  if (query?.trim()) score += queryOverlapBoost(text, query);
  return score;
}

/**
 * Best-effort keyword-overlap boost for the heuristic (no-AI) path — not real
 * language understanding, just rewards segments that share words with the
 * query. +4 per distinct query word (3+ letters) found in the segment.
 */
function queryOverlapBoost(text: string, query: string): number {
  const queryWords = new Set(
    query
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length >= 3),
  );
  if (queryWords.size === 0) return 0;
  const textLower = text.toLowerCase();
  let hits = 0;
  for (const w of queryWords) if (textLower.includes(w)) hits += 1;
  return hits * 4;
}

/** Raw scoreSegment() output (max 10) → 0-100 scale for HighlightWindow.score. */
export function normalizeHeuristicScore(raw: number): number {
  return Math.max(0, Math.min(100, Math.round(raw * 10)));
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
    .map((seg, i) => ({ i, seg, score: scoreSegment(seg.text, opts.query) }))
    .sort((a, b) => b.score - a.score);

  const picked: HighlightWindow[] = [];
  for (const { i, seg, score } of scored) {
    if (picked.length >= opts.maxClips) break;
    const win = windowAround(segments, i, opts.clipSeconds);
    // No overlaps with already-picked windows.
    if (picked.some((p) => win.start < p.end && p.start < win.end)) continue;
    picked.push({
      ...win,
      hook: seg.text.slice(0, 120),
      score: normalizeHeuristicScore(score),
    });
  }
  return picked.sort((a, b) => a.start - b.start);
}

/**
 * AI highlight picker: hands the timestamped transcript (and, when supplied,
 * sampled video frames) to the active provider and asks for the strongest
 * short-form moments. Frames let genre-agnostic/visually-driven content
 * (sports, vlogs, gaming — sparse dialogue) surface moments the transcript
 * alone would miss; only used when both `frames` is non-empty and the
 * provider implements analyzeFrames(). Falls back to the heuristic on any
 * parse/provider failure.
 */
export async function pickHighlights(
  segments: TranscriptSegment[],
  opts: PickOptions,
  provider?: AIProvider | null,
  frames?: AnalyzeFramesInput[],
): Promise<{
  windows: HighlightWindow[];
  pickedBy: 'ai' | 'ai-visual' | 'heuristic';
}> {
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

  const queryClause = opts.query?.trim()
    ? `\nOnly pick moments matching this request: "${opts.query.trim()}" — ` +
      `if fewer than ${opts.maxClips} moments genuinely match, return fewer rather ` +
      `than padding with unrelated moments.\n`
    : '';

  const useVisual = !!frames?.length && !!provider.analyzeFrames;
  const visualClause = useVisual
    ? `\nYou've also been given frames sampled across the video, labeled with their ` +
      `timestamps. Use them to catch visually-driven highlight moments (action, ` +
      `reactions, visual gags, energy spikes) that the transcript alone might miss — ` +
      `this matters most where dialogue is sparse or absent.\n`
    : '';

  const prompt = `You are a short-form video editor. Below is a timestamped transcript.
Pick the ${opts.maxClips} strongest self-contained moments for viral vertical clips
(~${opts.clipSeconds}s each). Moments must not overlap.
${queryClause}${visualClause}
Score each moment 0-100 on how strong it is as a standalone viral clip — weigh hook
strength (does it grab attention in the first second), narrative completeness (clean
start/end, doesn't cut off mid-thought), and emotional/energy peaks.

TRANSCRIPT:
${transcriptText}

Respond with ONLY a JSON array: [{"start": seconds, "end": seconds, "hook": "one-line caption hook", "score": 0-100}]`;

  try {
    const raw = useVisual
      ? await provider.analyzeFrames!(frames!, prompt)
      : await provider.generateText(prompt, {});
    const jsonStart = raw.search(/\[/);
    if (jsonStart === -1) throw new Error('no_json');
    const parsed = JSON.parse(
      raw.slice(jsonStart, raw.lastIndexOf(']') + 1),
    ) as Array<{
      start: number;
      end: number;
      hook?: string;
      score?: number;
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
        score: Number.isFinite(w.score)
          ? Math.max(0, Math.min(100, Math.round(w.score as number)))
          : 70,
      }))
      .slice(0, opts.maxClips)
      .sort((a, b) => a.start - b.start);
    // Note: an empty result here also falls through to the heuristic
    // fallback below, even when a `query` genuinely matched nothing (as
    // opposed to a parse/provider failure) — the heuristic has no real
    // language understanding, so its picks won't respect the query either.
    // Acceptable for now: "return something" beats "return nothing" as a
    // default, but callers relying on strict query filtering should treat
    // pickedBy: 'heuristic' alongside a query as a signal to double-check.
    if (windows.length === 0) throw new Error('empty');
    return { windows, pickedBy: useVisual ? 'ai-visual' : 'ai' };
  } catch {
    return {
      windows: pickHighlightsHeuristic(segments, opts),
      pickedBy: 'heuristic',
    };
  }
}
