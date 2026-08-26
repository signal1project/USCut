import { describe, it, expect } from 'vitest';
import { buildViralTextSequence } from '../viralText';
import type { PropertyListingSummary } from '../../types';

const listing: PropertyListingSummary = {
  id: 'x',
  source: 'zillow',
  mlsNumber: null,
  address: '99 Bates Ave NE',
  city: 'Atlanta',
  state: 'GA',
  zip: '30317',
  price: 45_000_000,
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
  filesFolder: null,
};

describe('buildViralTextSequence', () => {
  it('returns an empty array for zero photos', () => {
    expect(buildViralTextSequence(listing, 0)).toEqual([]);
  });

  it('opens with JUST LISTED and ends with the CTA line', () => {
    const lines = buildViralTextSequence(listing, 5);
    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe('JUST LISTED');
    expect(lines[4]).toBe('DM us to schedule a showing');
  });

  it('honors a ctaText override for the closing line', () => {
    const lines = buildViralTextSequence(listing, 3, 'Comment TOUR below');
    expect(lines[2]).toBe('Comment TOUR below');
  });

  it('cycles specs/location/price through the middle photos', () => {
    const lines = buildViralTextSequence(listing, 4);
    expect(lines.slice(1, 3)).toEqual(['3 BED · 2 BATH', 'Atlanta, GA']);
  });

  it('never throws with a single photo — CTA wins over the opening line', () => {
    const lines = buildViralTextSequence(listing, 1);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('JUST LISTED');
  });

  it('falls back to JUST LISTED for every slot when the listing has no other data', () => {
    const bare: PropertyListingSummary = {
      ...listing,
      city: '',
      state: '',
      beds: null,
      baths: null,
      price: null,
    };
    const lines = buildViralTextSequence(bare, 3);
    expect(lines[0]).toBe('JUST LISTED');
    expect(lines[1]).toBe('JUST LISTED');
  });
});
