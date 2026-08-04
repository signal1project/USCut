import { describe, it, expect } from 'vitest';
import { extractListingFromHtml } from '../urlCapture';

const JSONLD_PAGE = `<!DOCTYPE html><html><head>
<script type="application/ld+json">
{
  "@type": "SingleFamilyResidence",
  "address": {
    "streetAddress": "456 Oak Ave",
    "addressLocality": "Austin",
    "addressRegion": "TX",
    "postalCode": "78701"
  },
  "offers": { "price": 550000 },
  "numberOfBedrooms": 4,
  "numberOfBathroomsTotal": 3,
  "floorSize": { "value": 2400 },
  "image": ["https://photos.example.com/1.jpg", "https://photos.example.com/2.jpg"],
  "description": "Gorgeous corner-lot home &amp; garden."
}
</script>
</head><body></body></html>`;

const OG_PAGE = `<!DOCTYPE html><html><head>
<meta property="og:title" content="789 Pine Ct, Houston, TX 77002 | Listing"/>
<meta property="og:image" content="https://photos.example.com/og.jpg"/>
<meta property="og:description" content="Beautiful home listed at $312,500 with a big yard."/>
</head><body></body></html>`;

describe('extractListingFromHtml', () => {
  it('extracts from schema.org JSON-LD', () => {
    const p = extractListingFromHtml(
      JSONLD_PAGE,
      'https://www.realtor.com/realestateandhomes-detail/456-oak',
    );
    expect(p).not.toBeNull();
    expect(p!.source).toBe('realtor');
    expect(p!.address).toBe('456 Oak Ave');
    expect(p!.city).toBe('Austin');
    expect(p!.state).toBe('TX');
    expect(p!.zip).toBe('78701');
    expect(p!.price).toBe(55000000); // cents
    expect(p!.beds).toBe(4);
    expect(p!.baths).toBe(3);
    expect(p!.sqft).toBe(2400);
    expect(p!.photoUrls).toHaveLength(2);
    expect(p!.description).toContain('corner-lot home & garden');
  });

  it('falls back to OpenGraph title parsing', () => {
    const p = extractListingFromHtml(
      OG_PAGE,
      'https://someagentsite.com/listing/789',
    );
    expect(p).not.toBeNull();
    expect(p!.source).toBe('manual');
    expect(p!.address).toBe('789 Pine Ct');
    expect(p!.city).toBe('Houston');
    expect(p!.state).toBe('TX');
    expect(p!.zip).toBe('77002');
    expect(p!.price).toBe(31250000);
    expect(p!.photoUrls).toEqual(['https://photos.example.com/og.jpg']);
  });

  it('returns null when nothing extractable', () => {
    expect(
      extractListingFromHtml(
        '<html><head><title>Blog</title></head></html>',
        'https://x.com',
      ),
    ).toBeNull();
  });
});
