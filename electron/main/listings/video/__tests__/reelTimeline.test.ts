import { describe, it, expect } from 'vitest';
import {
  buildReelTimeline,
  CTA_BLOCK_DURATION_SECONDS,
  MUSIC_VOLUME,
  NARRATION_VOLUME,
} from '../reelTimeline';
import { assignPhotoBuckets } from '../roomBuckets';
import type { PropertyListingSummary } from '../../types';
import type { ResolvedCaptionStyle } from '../captionStyle';

const listing: PropertyListingSummary = {
  id: 'x',
  source: 'zillow',
  mlsNumber: null,
  address: '123 Main St',
  city: 'Yorkville',
  state: 'GA',
  zip: '30179',
  price: 38_900_000,
  beds: 3,
  baths: 2,
  sqft: 1850,
  lotSqft: null,
  yearBuilt: null,
  propertyType: null,
  status: 'active',
  daysOnMarket: null,
  description: null,
  photoUrls: [],
  photoCaptions: [],
  agentName: null,
  agentPhone: null,
  agentEmail: null,
  listingUrl: null,
  complianceOk: true,
  complianceFlags: [],
  capturedAt: new Date().toISOString(),
};

const fullPhotoSet = [
  { url: 'hook.jpg', caption: 'Front Exterior' },
  { url: 'kitchen.jpg', caption: 'Kitchen' },
  { url: 'living.jpg', caption: 'Living Room' },
  { url: 'bed.jpg', caption: 'Primary Bedroom' },
  { url: 'yard.jpg', caption: '1.2 Acres' },
];

// Stand-ins for what video/captionStyle.ts's resolveCaptionStyle() would
// return — reelTimeline.ts itself stays I/O-free, so tests supply these
// directly rather than resolving real font files from disk.
const STANDARD_STYLE: ResolvedCaptionStyle = {
  color: '#ffffff',
  fontFamily: 'Montserrat',
};
const LUXURY_STYLE: ResolvedCaptionStyle = {
  color: '#d4af37',
  fontFamily: 'Playfair Display',
};

describe('buildReelTimeline', () => {
  it('lays out photo clips + caption clips + CTA card contiguously with no gaps', () => {
    const assignment = assignPhotoBuckets(fullPhotoSet);
    const clips = buildReelTimeline(listing, assignment, {
      tier: 'standard',
      ctaBackgroundImage: 'cta-bg.jpg',
      captionStyle: STANDARD_STYLE,
    });

    const photoClips = clips.filter(
      (c) => c.type === 'image' && c.id !== 'reel-cta-bg',
    );
    expect(photoClips).toHaveLength(5);
    // Contiguous: each clip's startTime should equal the running sum of prior durations.
    let expectedStart = 0;
    for (const c of photoClips) {
      expect(c.startTime).toBeCloseTo(expectedStart, 5);
      expectedStart += c.duration;
    }
    // 5 blocks * their allotted seconds = 23s of photos, then a 5s CTA card = 28s total.
    expect(expectedStart).toBeCloseTo(23, 5);

    const cta = clips.find((c) => c.id === 'reel-cta-bg')!;
    expect(cta.startTime).toBeCloseTo(23, 5);
    expect(cta.duration).toBe(CTA_BLOCK_DURATION_SECONDS);
  });

  it('alternates zoom_in/zoom_out motion across all photo clips', () => {
    const assignment = assignPhotoBuckets(fullPhotoSet);
    const clips = buildReelTimeline(listing, assignment, {
      tier: 'standard',
      ctaBackgroundImage: 'cta-bg.jpg',
      captionStyle: STANDARD_STYLE,
    });
    const photoClips = clips.filter(
      (c) => c.type === 'image' && c.id !== 'reel-cta-bg',
    );
    photoClips.forEach((c, i) => {
      expect(c.motion).toBe(i % 2 === 0 ? 'zoom_in' : 'zoom_out');
    });
  });

  it('gives standard tier short whip transitions and luxury tier an 0.8s fade', () => {
    const assignment = assignPhotoBuckets(fullPhotoSet);
    const standard = buildReelTimeline(listing, assignment, {
      tier: 'standard',
      ctaBackgroundImage: 'cta-bg.jpg',
      captionStyle: STANDARD_STYLE,
    });
    const luxury = buildReelTimeline(listing, assignment, {
      tier: 'luxury',
      ctaBackgroundImage: 'cta-bg.jpg',
      captionStyle: LUXURY_STYLE,
    });
    const secondStandardPhoto = standard.filter((c) => c.type === 'image')[1];
    const secondLuxuryPhoto = luxury.filter((c) => c.type === 'image')[1];
    expect(secondStandardPhoto.transitionIn?.duration).toBe(0.2);
    expect(['wipeleft', 'wiperight']).toContain(
      secondStandardPhoto.transitionIn?.type,
    );
    expect(secondLuxuryPhoto.transitionIn).toEqual({
      type: 'fade',
      duration: 0.8,
    });
    // First clip overall never gets a transition (nothing to transition from).
    expect(
      standard.filter((c) => c.type === 'image')[0].transitionIn,
    ).toBeUndefined();
  });

  it('passes the resolved caption style (color + fontFamily) straight through to caption clips', () => {
    const assignment = assignPhotoBuckets(fullPhotoSet);
    const standard = buildReelTimeline(listing, assignment, {
      tier: 'standard',
      ctaBackgroundImage: 'cta-bg.jpg',
      captionStyle: STANDARD_STYLE,
    });
    const luxury = buildReelTimeline(listing, assignment, {
      tier: 'luxury',
      ctaBackgroundImage: 'cta-bg.jpg',
      captionStyle: LUXURY_STYLE,
    });
    const standardKitchen = standard.find(
      (c) => c.id === 'reel-caption-kitchen',
    );
    const luxuryKitchen = luxury.find((c) => c.id === 'reel-caption-kitchen');
    expect(standardKitchen?.captionStyle?.color).toBe('#ffffff');
    expect(standardKitchen?.captionStyle?.fontFamily).toBe('Montserrat');
    expect(luxuryKitchen?.captionStyle?.color).toBe('#d4af37');
    expect(luxuryKitchen?.captionStyle?.fontFamily).toBe('Playfair Display');
  });

  it('bakes the 4-line CTA card into one caption clip with newline-joined text', () => {
    const assignment = assignPhotoBuckets(fullPhotoSet);
    const clips = buildReelTimeline(listing, assignment, {
      tier: 'standard',
      ctaBackgroundImage: 'cta-bg.jpg',
      captionStyle: STANDARD_STYLE,
      ctaText: 'Open house Saturday',
    });
    const ctaText = clips.find((c) => c.id === 'reel-cta-text')!;
    const lines = ctaText.captionText!.split('\n');
    expect(lines).toEqual([
      '123 Main St',
      '3 bd · 2 ba · 1,850 sqft',
      '$389,000',
      'Open house Saturday',
    ]);
  });

  it('uses opts.hookText when given, and a default POV line otherwise', () => {
    const assignment = assignPhotoBuckets(fullPhotoSet);
    const withHook = buildReelTimeline(listing, assignment, {
      tier: 'standard',
      ctaBackgroundImage: 'cta-bg.jpg',
      captionStyle: STANDARD_STYLE,
      hookText: 'your dream backyard',
    });
    expect(
      withHook.find((c) => c.id === 'reel-caption-hook')?.captionText,
    ).toBe('POV: your dream backyard');
    const withoutHook = buildReelTimeline(listing, assignment, {
      tier: 'standard',
      ctaBackgroundImage: 'cta-bg.jpg',
      captionStyle: STANDARD_STYLE,
    });
    expect(
      withoutHook.find((c) => c.id === 'reel-caption-hook')?.captionText,
    ).toBe('POV: this could be yours');
  });

  it('skips buckets with zero photos instead of leaving a gap', () => {
    // Only a kitchen photo — hook/living/primary_bath/money_shot all end up empty.
    const assignment = assignPhotoBuckets([
      { url: 'k.jpg', caption: 'Kitchen' },
    ]);
    const clips = buildReelTimeline(listing, assignment, {
      tier: 'standard',
      ctaBackgroundImage: 'cta-bg.jpg',
      captionStyle: STANDARD_STYLE,
    });
    const photoClips = clips.filter(
      (c) => c.type === 'image' && c.id !== 'reel-cta-bg',
    );
    expect(photoClips).toHaveLength(1);
    expect(clips.find((c) => c.id === 'reel-cta-bg')?.startTime).toBeCloseTo(
      5,
      5,
    ); // kitchen block = 5s
  });

  it('adds narration and music as separate base-track audio clips with -20dB music', () => {
    const assignment = assignPhotoBuckets(fullPhotoSet);
    const clips = buildReelTimeline(listing, assignment, {
      tier: 'standard',
      ctaBackgroundImage: 'cta-bg.jpg',
      captionStyle: STANDARD_STYLE,
      narration: { path: 'narration.wav', durationSeconds: 27 },
      music: { path: 'music.mp3' },
    });
    const narration = clips.find((c) => c.id === 'reel-narration')!;
    const music = clips.find((c) => c.id === 'reel-music')!;
    expect(narration.type).toBe('audio');
    expect(narration.volume).toBe(NARRATION_VOLUME);
    expect(narration.duration).toBe(27);
    expect(music.type).toBe('audio');
    expect(music.volume).toBe(MUSIC_VOLUME);
  });

  it('omits narration/music clips entirely when not provided', () => {
    const assignment = assignPhotoBuckets(fullPhotoSet);
    const clips = buildReelTimeline(listing, assignment, {
      tier: 'standard',
      ctaBackgroundImage: 'cta-bg.jpg',
      captionStyle: STANDARD_STYLE,
    });
    expect(clips.find((c) => c.type === 'audio')).toBeUndefined();
  });

  it('never throws with zero photos, producing just the CTA card', () => {
    const assignment = assignPhotoBuckets([]);
    expect(() =>
      buildReelTimeline(listing, assignment, {
        tier: 'standard',
        ctaBackgroundImage: 'cta-bg.jpg',
        captionStyle: STANDARD_STYLE,
      }),
    ).not.toThrow();
    const clips = buildReelTimeline(listing, assignment, {
      tier: 'standard',
      ctaBackgroundImage: 'cta-bg.jpg',
      captionStyle: STANDARD_STYLE,
    });
    expect(clips.filter((c) => c.type === 'image')).toHaveLength(1); // just the CTA bg
    expect(clips.find((c) => c.id === 'reel-cta-bg')?.startTime).toBe(0);
  });
});
