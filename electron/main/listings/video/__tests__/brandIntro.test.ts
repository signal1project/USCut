import { describe, it, expect } from 'vitest';
import { buildBrandIntroLines } from '../brandIntro';
import type { BrandKit } from '../../../settings/settings';

function kit(overrides: Partial<BrandKit> = {}): BrandKit {
  return {
    brandName: 'Dale Brown Real Estate',
    bio: '',
    voice: '',
    audience: '',
    hashtags: [],
    bannedWords: [],
    signature: '',
    ...overrides,
  };
}

describe('buildBrandIntroLines', () => {
  it('returns null when no brand kit is configured', () => {
    expect(buildBrandIntroLines(null)).toBeNull();
  });

  it('returns null when the brand kit has no name set', () => {
    expect(buildBrandIntroLines(kit({ brandName: '' }))).toBeNull();
    expect(buildBrandIntroLines(kit({ brandName: undefined }))).toBeNull();
  });

  it('returns just the brand name when no tagline is set', () => {
    expect(buildBrandIntroLines(kit())).toEqual(['Dale Brown Real Estate']);
  });

  it('appends the signature as a second line when present', () => {
    expect(
      buildBrandIntroLines(kit({ signature: 'Your Kirkwood Expert' })),
    ).toEqual(['Dale Brown Real Estate', 'Your Kirkwood Expert']);
  });

  it('trims whitespace on both lines', () => {
    expect(
      buildBrandIntroLines(
        kit({ brandName: '  Dale Brown  ', signature: '  Trusted  ' }),
      ),
    ).toEqual(['Dale Brown', 'Trusted']);
  });

  it('falls back to `name` when brandName is unset — the shape Settings.getActiveBrandKit() actually returns (a BrandProfile, not the legacy single BrandKit)', () => {
    const profile = { ...kit({ brandName: undefined }), name: 'Company One' };
    expect(buildBrandIntroLines(profile)).toEqual(['Company One']);
  });
});
