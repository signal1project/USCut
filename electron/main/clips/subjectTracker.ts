import type { AIProvider } from '@mas/types';
import { sampleFrames } from './frameSampler';

export interface TrackPoint {
  /** Seconds relative to the clip window's own start (0 = first frame of the cut clip). */
  t: number;
  /** Normalized subject center, 0-1 across the frame width. */
  cx: number;
  /** Normalized subject center, 0-1 across the frame height. */
  cy: number;
}

const TRACK_INTERVAL_SECONDS = 1;
const MAX_TRACK_FRAMES = 20; // bounds cost/latency on long clips

function trackingPrompt(frameCount: number): string {
  return `These are ${frameCount} sequential frames sampled from a video clip, in order.
For each frame, locate the primary subject (the main speaker/person/focal subject — if
several people are visible, pick whoever is most active/talking/central to the action).

Respond with ONLY a JSON object: {"points": [{"t": seconds, "cx": 0-1, "cy": 0-1}, ...]}
— one entry per frame, "t" matching the frame's timestamp label, "cx"/"cy" the subject's
center as a fraction of frame width/height (0,0 = top-left, 1,1 = bottom-right). If no
clear subject is visible in a frame, omit that frame's entry rather than guessing.`;
}

/**
 * Samples frames across a highlight window and asks a vision-capable
 * AIProvider where the primary subject is in each — the raw material for a
 * moving (subject-tracking) crop instead of a fixed center-crop. Returns
 * null (never throws) when no vision-capable provider is configured, or on
 * any sampling/parse/provider failure — callers fall back to a fixed crop.
 */
export async function trackSubject(
  videoPath: string,
  window: { start: number; end: number },
  provider: AIProvider | null | undefined,
): Promise<TrackPoint[] | null> {
  if (!provider?.analyzeFrames) return null;

  try {
    const frames = await sampleFrames(videoPath, {
      startSeconds: window.start,
      endSeconds: window.end,
      intervalSeconds: TRACK_INTERVAL_SECONDS,
      maxFrames: MAX_TRACK_FRAMES,
    });
    if (frames.length === 0) return null;

    const raw = await provider.analyzeFrames(
      frames.map((f) => ({
        timestampSeconds: Math.round((f.timestampSeconds - window.start) * 100) / 100,
        base64Jpeg: f.base64Jpeg,
      })),
      trackingPrompt(frames.length),
    );

    const jsonStart = raw.search(/\{/);
    if (jsonStart === -1) return null;
    const parsed = JSON.parse(raw.slice(jsonStart, raw.lastIndexOf('}') + 1)) as {
      points?: Array<{ t: number; cx: number; cy: number }>;
    };
    const points = (parsed.points ?? [])
      .filter(
        (p) =>
          Number.isFinite(p.t) &&
          Number.isFinite(p.cx) &&
          Number.isFinite(p.cy),
      )
      .map((p) => ({
        t: Math.max(0, p.t),
        cx: Math.max(0, Math.min(1, p.cx)),
        cy: Math.max(0, Math.min(1, p.cy)),
      }))
      .sort((a, b) => a.t - b.t);

    return points.length > 0 ? points : null;
  } catch {
    return null;
  }
}
