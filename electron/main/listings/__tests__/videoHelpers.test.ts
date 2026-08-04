import { describe, it, expect } from 'vitest';
import {
  escapeDrawtext,
  buildKenBurnsFilter,
  buildNarrationScript,
} from '../videoService';
import type { PropertyListingSummary } from '../types';

const listing: PropertyListingSummary = {
  id: 'x',
  source: 'zillow',
  mlsNumber: null,
  address: "123 O'Malley St",
  city: 'Houston',
  state: 'TX',
  zip: '77002',
  price: 42500000,
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
  agentName: null,
  agentPhone: null,
  agentEmail: null,
  listingUrl: null,
  complianceOk: true,
  complianceFlags: [],
  capturedAt: new Date().toISOString(),
};

describe('escapeDrawtext', () => {
  it('escapes ffmpeg-significant characters', () => {
    expect(escapeDrawtext('a:b,c%d')).toBe('a\\:b\\,c\\%d');
    expect(escapeDrawtext("O'Malley")).toBe('O’Malley');
  });
});

describe('buildKenBurnsFilter', () => {
  it('zooms in on even indexes and pans on odd', () => {
    const even = buildKenBurnsFilter(0, 3, '123 Main St');
    const odd = buildKenBurnsFilter(1, 3, '123 Main St');
    expect(even).toContain("z='min(1.0015^on,1.13)'");
    expect(odd).toContain('z=1.13');
    expect(even).toContain('s=1080x1920');
    expect(even).toContain('d=90'); // 3s * 30fps
    expect(even).toContain('drawtext=');
  });

  it('omits drawtext when no banner', () => {
    expect(buildKenBurnsFilter(0, 3, '')).not.toContain('drawtext');
  });
});

describe('buildNarrationScript', () => {
  it('speaks the address, specs, price, and CTA', () => {
    const script = buildNarrationScript(listing);
    expect(script).toContain("123 O'Malley St, Houston, TX");
    expect(script).toContain('3 bedrooms, 2 baths, 1,850 square feet');
    expect(script).toContain('425,000 dollars');
    expect(script).toContain('private showing');
  });
});
