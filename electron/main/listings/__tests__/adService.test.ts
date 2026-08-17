import { describe, it, expect } from 'vitest';
import {
  ListingAdService,
  buildListingBrief,
  buildListingTemplate,
} from '../adService';
import type { ListingStore } from '../listingStore';
import type { ContentService } from '../../content';
import type { PropertyListingSummary } from '../types';

const listing: PropertyListingSummary = {
  id: 'lst-1',
  source: 'zillow',
  mlsNumber: null,
  address: '123 Main St',
  city: 'Houston',
  state: 'TX',
  zip: '77002',
  price: 42500000,
  beds: 3,
  baths: 2,
  sqft: 1850,
  lotSqft: null,
  yearBuilt: 2004,
  propertyType: 'single_family',
  status: 'active',
  daysOnMarket: 4,
  description: 'Charming 3/2 with updated kitchen.',
  photoUrls: [],
  agentName: null,
  agentPhone: null,
  agentEmail: null,
  listingUrl: 'https://www.zillow.com/homedetails/123-main-st',
  complianceOk: true,
  complianceFlags: [],
  capturedAt: new Date().toISOString(),
};

function storeWith(l: PropertyListingSummary | null): ListingStore {
  return {
    capture: () => Promise.reject(new Error('not used')),
    list: () => Promise.reject(new Error('not used')),
    get: () => Promise.resolve(l),
    remove: () => Promise.reject(new Error('not used')),
  };
}

const noProviderContent = {
  generate: () =>
    Promise.reject(
      new Error('No AI provider configured. Set one in Settings.'),
    ),
} as unknown as ContentService;

describe('ListingAdService', () => {
  it('returns null for an unknown listing', async () => {
    const svc = new ListingAdService(storeWith(null), noProviderContent);
    expect(
      await svc.generateAd('nope', { platforms: ['facebook'] }),
    ).toBeNull();
  });

  it('falls back to templates when no AI provider is configured', async () => {
    const svc = new ListingAdService(storeWith(listing), noProviderContent);
    const result = await svc.generateAd('lst-1', {
      platforms: ['facebook', 'instagram'],
      highlight: 'new roof',
    });
    expect(result?.provider).toBe('template');
    expect(result?.items).toHaveLength(2);
    const fb = result!.items.find((i) => i.platform === 'facebook')!;
    expect(fb.body).toContain('123 Main St');
    expect(fb.body).toContain('$425,000');
    expect(fb.body).toContain('new roof');
    expect(fb.complianceOk).toBe(true);
    expect(fb.hashtags).toContain('RealEstate');
  });

  it('uses the AI provider when available and compliance-checks its output', async () => {
    const aiContent = {
      generate: ({ platforms }: { platforms: string[] }) =>
        Promise.resolve({
          provider: 'anthropic',
          items: platforms.map((platform) => ({
            platform,
            body: 'Stunning home in a prestigious neighborhood! DM to book. #RealEstate',
            hashtags: ['#RealEstate'],
          })),
        }),
    } as unknown as ContentService;

    const svc = new ListingAdService(storeWith(listing), aiContent);
    const result = await svc.generateAd('lst-1', { platforms: ['facebook'] });
    expect(result?.provider).toBe('anthropic');
    const ad = result!.items[0];
    // "prestigious neighborhood" is a warn (not a block) — copy stays publishable
    expect(ad.complianceOk).toBe(true);
    expect(
      ad.complianceFlags.some((f) => f.rule === 'FH-EXCLUSIVITY-WARN'),
    ).toBe(true);
  });

  it('marks discriminatory AI output as blocked', async () => {
    const badContent = {
      generate: () =>
        Promise.resolve({
          provider: 'openai',
          items: [
            {
              platform: 'facebook',
              body: 'Great condo, adults only building! #JustListed',
              hashtags: [],
            },
          ],
        }),
    } as unknown as ContentService;

    const svc = new ListingAdService(storeWith(listing), badContent);
    const result = await svc.generateAd('lst-1', { platforms: ['facebook'] });
    const ad = result!.items[0];
    expect(ad.complianceOk).toBe(false);
    expect(
      ad.complianceFlags.some(
        (f) => f.rule === 'FH-FAMILIAL' && f.severity === 'block',
      ),
    ).toBe(true);
  });

  it('buildListingBrief embeds listing facts and fair-housing constraints', () => {
    const brief = buildListingBrief(listing, {
      platforms: ['facebook'],
      highlight: 'pool',
    });
    expect(brief).toContain('123 Main St, Houston, TX 77002');
    expect(brief).toContain('$425,000');
    expect(brief).toContain('Fair Housing Act');
    expect(brief).toContain('pool');
  });

  it('buildListingTemplate varies CTA by platform', () => {
    expect(buildListingTemplate(listing, 'twitter')).toContain(
      'DM for details!',
    );
    expect(buildListingTemplate(listing, 'facebook')).toContain(
      'Schedule your private showing',
    );
  });

  it('buildListingBrief truncates a long description at a sentence boundary, not mid-word', () => {
    const sentence = 'This home has a gorgeous renovated kitchen with quartz counters. ';
    const longDescription = sentence.repeat(20); // well over 800 chars
    const brief = buildListingBrief(
      { ...listing, description: longDescription },
      { platforms: ['facebook'] },
    );
    const descLine = brief
      .split('\n')
      .find((l) => l.startsWith('- Description:'))!;
    const text = descLine.replace('- Description: ', '');
    expect(text.length).toBeLessThanOrEqual(800);
    // Ends on a full sentence (no mid-word cut) since the repeated sentence
    // has a clean boundary well before the 800-char cap.
    expect(text.trim().endsWith('.')).toBe(true);
    expect(text).not.toMatch(/\bquartz cou$/); // would indicate a mid-word cut
  });

  it('buildListingBrief keeps a short description untouched', () => {
    const brief = buildListingBrief(listing, { platforms: ['facebook'] });
    expect(brief).toContain(
      '- Description: Charming 3/2 with updated kitchen.',
    );
  });
});
