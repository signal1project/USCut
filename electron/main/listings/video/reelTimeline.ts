import type { TimelineClip } from '../../aicuts/ffmpegOps';
import type { PropertyListingSummary } from '../types';
import type { PriceTier } from './priceTier';
import type { ResolvedCaptionStyle } from './captionStyle';
import {
  REEL_BUCKET_PLAN,
  resolveMoneyShotLabel,
  type BucketAssignment,
} from './roomBuckets';
import { buildCtaLines } from './ctaCard';

export const CTA_BLOCK_DURATION_SECONDS = 5;

const LUXURY_TRANSITION = { type: 'fade', duration: 0.8 };
// Two alternating whip-style cuts (short xfade wipes) so consecutive
// transitions don't look identical — 'wipeleft'/'wiperight'/'slideup'/
// 'circleopen'/'fade' are the only types exportGraph.ts's XFADE_TRANSITIONS
// actually honors; anything else silently falls back to 'fade' there.
const STANDARD_TRANSITIONS = [
  { type: 'wipeleft', duration: 0.2 },
  { type: 'wiperight', duration: 0.2 },
];

/**
 * Music is mixed at a fixed -20dB (volume 0.1) under narration (volume 1.0)
 * rather than relying on exportGraph's `duckMusic` sidechain: that mechanism
 * ducks a music bus against embedded audio on a `type:'video'` base-track
 * clip, but a reel's base track is 100% photos (image clips, no embedded
 * audio) — so there is no "voice" signal for the sidechain to key off, and
 * duckMusic would be a silent no-op here. A fixed -20dB level satisfies the
 * spec's literal "mix at -20dB music" requirement directly.
 */
export const MUSIC_VOLUME = 0.1;
export const NARRATION_VOLUME = 1.0;

function transitionFor(tier: PriceTier, clipIndex: number) {
  if (tier === 'luxury') return LUXURY_TRANSITION;
  return STANDARD_TRANSITIONS[clipIndex % STANDARD_TRANSITIONS.length];
}

function captionStyleFor(
  resolved: ResolvedCaptionStyle,
  position: 'bottom' | 'middle',
) {
  return {
    bold: true,
    position,
    color: resolved.color,
    fontFamily: resolved.fontFamily,
  };
}

export interface ReelTimelineOptions {
  tier: PriceTier;
  hookText?: string;
  ctaText?: string;
  /** Pre-rendered solid-background image for the CTA card (any size — scaled to fit). */
  ctaBackgroundImage: string;
  /** Font/color for captions, resolved via video/captionStyle.ts (this module stays I/O-free). */
  captionStyle: ResolvedCaptionStyle;
  narration?: { path: string; durationSeconds: number } | null;
  music?: { path: string } | null;
}

/**
 * Builds the reel-spec timeline (hook → kitchen → living → primary+bath →
 * money-shot → CTA), ready for electron/main/aicuts/ffmpegOps.ts's
 * exportProject(). Buckets with zero assigned photos are skipped rather
 * than padded with a gap, so a listing with fewer photos than buckets
 * produces a shorter (but still valid) reel instead of a black hole.
 */
export function buildReelTimeline(
  listing: PropertyListingSummary,
  assignment: BucketAssignment,
  opts: ReelTimelineOptions,
): TimelineClip[] {
  const clips: TimelineClip[] = [];
  let cursor = 0;
  let clipIndex = 0;

  for (const spec of REEL_BUCKET_PLAN) {
    const photos = assignment.assignments.get(spec.bucket) ?? [];
    if (photos.length === 0) continue;

    const blockDuration = spec.endSec - spec.startSec;
    const perPhoto = blockDuration / photos.length;
    const label =
      spec.bucket === 'hook'
        ? `POV: ${opts.hookText || 'this could be yours'}`
        : spec.bucket === 'money_shot'
          ? resolveMoneyShotLabel(assignment)
          : spec.label;
    const blockStart = cursor;

    photos.forEach((photo) => {
      clips.push({
        id: `reel-photo-${clipIndex}`,
        src: photo.url,
        type: 'image',
        trackIndex: 0,
        startTime: cursor,
        trimStart: 0,
        trimEnd: 0,
        duration: perPhoto,
        motion: clipIndex % 2 === 0 ? 'zoom_in' : 'zoom_out',
        transitionIn: clipIndex === 0 ? undefined : transitionFor(opts.tier, clipIndex),
      });
      cursor += perPhoto;
      clipIndex += 1;
    });

    if (label) {
      clips.push({
        id: `reel-caption-${spec.bucket}`,
        src: photos[0].url, // unused by the caption path, kept for a valid TimelineClip
        type: 'caption',
        trackIndex: 0,
        startTime: blockStart,
        trimStart: 0,
        trimEnd: 0,
        duration: blockDuration,
        captionText: label,
        captionStyle: captionStyleFor(opts.captionStyle, 'bottom'),
      });
    }
  }

  // CTA card (block 6) — one caption clip carries all 4 lines via literal
  // newlines; buildAssSubtitles renders \n as ASS \N hard line breaks.
  const ctaStart = cursor;
  clips.push({
    id: 'reel-cta-bg',
    src: opts.ctaBackgroundImage,
    type: 'image',
    trackIndex: 0,
    startTime: ctaStart,
    trimStart: 0,
    trimEnd: 0,
    duration: CTA_BLOCK_DURATION_SECONDS,
    transitionIn: clipIndex === 0 ? undefined : transitionFor(opts.tier, clipIndex),
  });
  clips.push({
    id: 'reel-cta-text',
    src: opts.ctaBackgroundImage,
    type: 'caption',
    trackIndex: 0,
    startTime: ctaStart,
    trimStart: 0,
    trimEnd: 0,
    duration: CTA_BLOCK_DURATION_SECONDS,
    captionText: buildCtaLines(listing, { ctaText: opts.ctaText }).join('\n'),
    captionStyle: captionStyleFor(opts.captionStyle, 'middle'),
  });
  cursor += CTA_BLOCK_DURATION_SECONDS;

  if (opts.narration) {
    clips.push({
      id: 'reel-narration',
      src: opts.narration.path,
      type: 'audio',
      trackIndex: 0,
      startTime: 0,
      trimStart: 0,
      trimEnd: 0,
      duration: opts.narration.durationSeconds,
      volume: NARRATION_VOLUME,
    });
  }

  if (opts.music) {
    clips.push({
      id: 'reel-music',
      src: opts.music.path,
      type: 'audio',
      trackIndex: 0,
      startTime: 0,
      trimStart: 0,
      trimEnd: 0,
      // Declared duration only bounds ffmpeg's atrim end — the final mix is
      // clamped to the video's real length regardless, and a track shorter
      // than the reel just plays once and pads with silence, so an
      // over-generous value here is always safe.
      duration: Math.max(cursor, 60),
      volume: MUSIC_VOLUME,
    });
  }

  return clips;
}
