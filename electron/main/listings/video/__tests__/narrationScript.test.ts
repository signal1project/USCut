import { describe, it, expect } from 'vitest';
import { buildReelNarrationScript } from '../narrationScript';
import { assignPhotoBuckets } from '../roomBuckets';
import type { PropertyListingSummary } from '../../types';

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

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

describe('buildReelNarrationScript', () => {
  it('follows Hook + features + location + CTA, landing in a ~28s word-count band', () => {
    const assignment = assignPhotoBuckets([
      { url: 'a', caption: 'Updated Kitchen' },
      { url: 'b', caption: 'Open Concept Living Room' },
      { url: 'c', caption: 'Front Exterior' },
    ]);
    const script = buildReelNarrationScript(listing, assignment);

    expect(script).toContain('Yorkville');
    expect(script).toContain('GA');
    expect(script).toContain('TOUR');
    expect(script).toContain('$389,000');
    expect(script.toLowerCase()).toContain('updated kitchen');
    expect(script.toLowerCase()).toContain('open concept living room');
    // ~28s at ~150-160wpm ≈ 65-95 words; generous band since exact wording
    // is a copywriting heuristic, not a fixed contract.
    expect(wordCount(script)).toBeGreaterThanOrEqual(40);
    expect(wordCount(script)).toBeLessThanOrEqual(100);
  });

  it('falls back to generic specs when no bucket has a caption', () => {
    const assignment = assignPhotoBuckets([{ url: 'a' }, { url: 'b' }]);
    const script = buildReelNarrationScript(listing, assignment);
    expect(script).toContain('3 bedrooms');
    expect(script).toContain('2 baths');
    expect(script).toContain('1,850 square feet');
    expect(script).toContain('TOUR');
  });

  it('honors an explicit hookText override', () => {
    const assignment = assignPhotoBuckets([{ url: 'a' }]);
    const script = buildReelNarrationScript(listing, assignment, {
      hookText: 'POV: your new backyard oasis',
    });
    expect(script.startsWith('POV: your new backyard oasis.')).toBe(true);
  });

  it('never throws and still produces a CTA with zero photos', () => {
    const assignment = assignPhotoBuckets([]);
    const script = buildReelNarrationScript(listing, assignment);
    expect(script).toContain('TOUR');
    expect(script).toContain('Yorkville');
  });
});
