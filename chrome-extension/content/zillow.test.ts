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

  it('caps at 10 entries', () => {
    const raw = Array.from({ length: 15 }, (_, i) => ({
      url: `https://photos.zillowstatic.com/${i}.jpg`,
    }));
    expect(extractPhotoEntries(raw)).toHaveLength(10);
  });

  it('returns an empty array for missing/non-array input', () => {
    expect(extractPhotoEntries(undefined)).toEqual([]);
    expect(extractPhotoEntries(null)).toEqual([]);
  });
});
