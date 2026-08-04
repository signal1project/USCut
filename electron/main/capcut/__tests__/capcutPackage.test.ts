import { describe, expect, it } from 'vitest';
import type { Platform } from '@mas/types';
import { CapCutPackageService } from '../index';

// RED tests for editable CapCut production-package generation.

describe('CapCutPackageService', () => {
  it('builds an editable package per target platform with scenes, captions, and approval metadata', () => {
    const service = new CapCutPackageService({
      now: () => new Date('2026-06-03T12:00:00Z'),
    });

    const pkg = service.createPackage({
      campaignId: 'camp-1',
      campaignTitle: 'Family Office Web Design Offer',
      platforms: ['instagram', 'tiktok'] as Platform[],
      hook: 'Your local business website is quietly leaking leads',
      script:
        'Most small businesses lose trust before the first phone call. Here is the fix.',
      captionVariants: [
        {
          platform: 'instagram',
          body: 'Stop leaking leads. #SmallBusiness',
          hashtags: ['#SmallBusiness'],
        },
        {
          platform: 'tiktok',
          body: 'Your website has 3 seconds. #BusinessTok',
          hashtags: ['#BusinessTok'],
        },
      ],
      trendKeywords: ['small business website', 'lead generation'],
      strategyNotes: [
        'Use a strong first-frame text hook',
        'Keep vertical 9:16',
      ],
    });

    expect(pkg.id).toMatch(/^capcut_camp-1_/);
    expect(pkg.status).toBe('draft');
    expect(pkg.approval.required).toBe(true);
    expect(pkg.platforms).toEqual(['instagram', 'tiktok']);
    expect(pkg.scenes.length).toBeGreaterThanOrEqual(3);
    expect(pkg.scenes[0].voiceover).toContain('Your local business website');
    expect(pkg.exports[0]).toMatchObject({
      platform: 'instagram',
      aspectRatio: '9:16',
    });
    expect(pkg.manifestFileName).toBe(
      'capcut-package-camp-1-2026-06-03T120000000Z.json',
    );
  });

  it('keeps the package human-editable and does not mark it as auto-rendered', () => {
    const service = new CapCutPackageService({
      now: () => new Date('2026-06-03T12:00:00Z'),
    });

    const pkg = service.createPackage({
      campaignId: 'camp-2',
      campaignTitle: 'Editable First',
      platforms: ['youtube'] as Platform[],
      hook: 'Hook',
      script: 'Line one. Line two. Line three.',
      captionVariants: [],
      trendKeywords: [],
      strategyNotes: [],
    });

    expect(pkg.editingMode).toBe('editable_project_package');
    expect(pkg.rendering.automatedExport).toBe(false);
    expect(pkg.rendering.instructions).toContain('Open in CapCut');
  });
});
