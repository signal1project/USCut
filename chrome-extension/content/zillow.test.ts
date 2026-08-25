import { describe, expect, it } from 'vitest';
import { findZillowProperty, extractPhotoEntries } from './zillow';

describe('Zillow extractor hydration parsing', () => {
  const property = {
    zpid: 12345,
    address: {
      streetAddress: '123 Main St',
      city: 'Austin',
      state: 'TX',
      zipcode: '78701',
    },
    price: 450000,
    bedrooms: 4,
    photos: [{ url: 'https://photos.zillowstatic.com/fp/test.jpg' }],
  };

  it('finds a property in an object cache', () => {
    expect(findZillowProperty({ SomeQuery: { property } })).toMatchObject(
      property,
    );
  });

  it('parses Zillow gdpClientCache when it is JSON encoded as a string', () => {
    const cache = JSON.stringify({ SomeQuery: { property } });
    expect(findZillowProperty(cache)).toMatchObject(property);
  });

  it('ignores unrelated hydration data', () => {
    expect(findZillowProperty({ viewer: { name: 'Test User' } })).toBeNull();
  });

  it('finds a property nested under pageProps.componentProps.gdpClientCache (current Zillow schema)', () => {
    // Zillow moved gdpClientCache from pageProps directly to
    // pageProps.componentProps.gdpClientCache; extractZillow() passes both
    // as array candidates, so findZillowProperty must still locate the
    // property regardless of which shape is present.
    const cache = JSON.stringify({ ForSaleBotsQuery: { property } });
    const pageProps = { componentProps: { gdpClientCache: cache } };
    expect(
      findZillowProperty([
        pageProps.componentProps.gdpClientCache,
        pageProps,
      ]),
    ).toMatchObject(property);
  });
});

describe('extractPhotoEntries', () => {
  it('pairs url and caption, checking multiple candidate caption keys', () => {
    const entries = extractPhotoEntries([
      { url: 'https://photos.zillowstatic.com/1.jpg', caption: 'Kitchen' },
      { url: 'https://photos.zillowstatic.com/2.jpg', text: 'Living Room' },
      { url: 'https://photos.zillowstatic.com/3.jpg', roomLabel: 'Primary Bedroom' },
      { url: 'https://photos.zillowstatic.com/4.jpg' },
    ]);
    expect(entries).toEqual([
      { url: 'https://photos.zillowstatic.com/1.jpg', caption: 'Kitchen' },
      { url: 'https://photos.zillowstatic.com/2.jpg', caption: 'Living Room' },
      { url: 'https://photos.zillowstatic.com/3.jpg', caption: 'Primary Bedroom' },
      { url: 'https://photos.zillowstatic.com/4.jpg', caption: null },
    ]);
  });

  it('accepts bare string photo entries with no caption', () => {
    expect(
      extractPhotoEntries(['https://photos.zillowstatic.com/1.jpg']),
    ).toEqual([{ url: 'https://photos.zillowstatic.com/1.jpg', caption: null }]);
  });

  it('falls back to mixedSources.jpeg when url is absent', () => {
    const entries = extractPhotoEntries([
      {
        mixedSources: { jpeg: [{ url: 'https://photos.zillowstatic.com/a.jpg' }, { url: 'https://photos.zillowstatic.com/b.jpg' }] },
        caption: 'Backyard',
      },
    ]);
    expect(entries).toEqual([
      { url: 'https://photos.zillowstatic.com/b.jpg', caption: 'Backyard' },
    ]);
  });

  it('prefers the largest mixedSources.jpeg variant over a small bare url', () => {
    // Real Zillow shape: `.url` is a ~400x300 thumbnail ("p_d.jpg"); the
    // last mixedSources.jpeg entry is the largest size actually served
    // (~1024px wide) for the same photo — using `.url` directly produces
    // visibly pixelated reels once upscaled to 1080px video.
    const entries = extractPhotoEntries([
      {
        url: 'https://photos.zillowstatic.com/fp/abc-p_d.jpg',
        mixedSources: {
          jpeg: [
            { url: 'https://photos.zillowstatic.com/fp/abc-cc_ft_768.jpg', width: 768 },
            { url: 'https://photos.zillowstatic.com/fp/abc-cc_ft_1536.jpg', width: 1536 },
          ],
        },
        caption: 'Kitchen',
      },
    ]);
    expect(entries).toEqual([
      {
        url: 'https://photos.zillowstatic.com/fp/abc-cc_ft_1536.jpg',
        caption: 'Kitchen',
      },
    ]);
  });

  it('drops non-http entries and dedupes by url, keeping caption alignment', () => {
    const entries = extractPhotoEntries([
      { url: 'not-a-url', caption: 'Junk' },
      { url: 'https://photos.zillowstatic.com/1.jpg', caption: 'Kitchen' },
      { url: 'https://photos.zillowstatic.com/1.jpg', caption: 'Duplicate' },
    ]);
    expect(entries).toEqual([
      { url: 'https://photos.zillowstatic.com/1.jpg', caption: 'Kitchen' },
    ]);
  });

  it('caps at 250 entries', () => {
    const raw = Array.from({ length: 300 }, (_, i) => ({
      url: `https://photos.zillowstatic.com/${i}.jpg`,
    }));
    expect(extractPhotoEntries(raw)).toHaveLength(250);
  });

  it('returns an empty array for missing/non-array input', () => {
    expect(extractPhotoEntries(undefined)).toEqual([]);
    expect(extractPhotoEntries(null)).toEqual([]);
  });
});
