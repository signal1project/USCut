import { describe, expect, it } from 'vitest';
import { findZillowProperty } from './zillow';

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
