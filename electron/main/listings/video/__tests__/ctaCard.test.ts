import { describe, it, expect } from 'vitest';
import { buildCtaLines } from '../ctaCard';
import type { PropertyListingSummary } from '../../types';

const base: PropertyListingSummary = {
  id: 'x',
  source: 'zillow',
  mlsNumber: null,
  address: '123 Main St, Yorkville GA 30179',
  city: 'Yorkville',
  state: 'GA',
  zip: '30179',
  price: 38_900_000,
  beds: 3,
  baths: 2,
  sqft: null,
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

describe('buildCtaLines', () => {
  it('orders lines as address, specs, price, then the DM-to-tour line', () => {
    expect(buildCtaLines(base)).toEqual([
      '123 Main St, Yorkville GA 30179',
      '3 bd · 2 ba',
      '$389,000',
      "DM 'TOUR' for private showing",
    ]);
  });

  it('lets ctaText override only the final line', () => {
    expect(buildCtaLines(base, { ctaText: 'Open house Saturday 1-3pm' })).toEqual([
      '123 Main St, Yorkville GA 30179',
      '3 bd · 2 ba',
      '$389,000',
      'Open house Saturday 1-3pm',
    ]);
  });

  it('omits missing specs/price cleanly instead of blank lines', () => {
    const noSpecs: PropertyListingSummary = {
      ...base,
      beds: null,
      baths: null,
      sqft: null,
      price: null,
    };
    expect(buildCtaLines(noSpecs)).toEqual([
      '123 Main St, Yorkville GA 30179',
      "DM 'TOUR' for private showing",
    ]);
  });
});
