import type { ListingCapturePayload, ListingSource } from './types';

/**
 * Server-side listing capture from a pasted URL — no Chrome extension needed.
 * Parses schema.org JSON-LD blocks and OpenGraph meta tags, which most listing
 * and brokerage pages emit for SEO. Heavier JS-rendered pages (and bot-walled
 * ones) still need the extension; this is the convenience path.
 */

function sourceFromUrl(url: string): ListingSource {
  return /zillow\.com/i.test(url) ? 'zillow' : 'manual';
}

function metaContent(html: string, property: string): string | undefined {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*content=["']([^"']*)["']`,
    'i',
  );
  const m = html.match(re);
  if (m) return m[1];
  // content-before-property ordering
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`,
    'i',
  );
  return html.match(re2)?.[1];
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

interface JsonLdCandidate {
  address?: {
    streetAddress?: string;
    addressLocality?: string;
    addressRegion?: string;
    postalCode?: string;
  };
  offers?: { price?: number | string };
  price?: number | string;
  numberOfRooms?: number;
  numberOfBedrooms?: number;
  numberOfBathroomsTotal?: number;
  floorSize?: { value?: number };
  image?: string | string[];
  description?: string;
  name?: string;
  '@type'?: string | string[];
}

function* jsonLdBlocks(html: string): Generator<unknown> {
  const re =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      yield JSON.parse(m[1].trim());
    } catch {
      /* skip malformed blocks */
    }
  }
}

function priceToCents(raw: number | string | undefined): number | undefined {
  if (raw == null) return undefined;
  const n =
    typeof raw === 'number'
      ? raw
      : parseFloat(String(raw).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : undefined;
}

/** Parse listing data out of raw page HTML. Exported for tests. */
export function extractListingFromHtml(
  html: string,
  url: string,
): ListingCapturePayload | null {
  const source = sourceFromUrl(url);

  // ── 1. schema.org JSON-LD (best structured source) ─────────────────────────
  const flat: JsonLdCandidate[] = [];
  for (const block of jsonLdBlocks(html)) {
    const items = Array.isArray(block)
      ? block
      : Array.isArray((block as { '@graph'?: unknown[] })['@graph'])
        ? (block as { '@graph': unknown[] })['@graph']
        : [block];
    for (const item of items) flat.push(item as JsonLdCandidate);
  }
  const productish = flat.find((c) => {
    const t = ([] as string[]).concat((c['@type'] as string | string[]) ?? []);
    return (
      t.some((x) =>
        /Residence|House|Apartment|Product|Offer|RealEstateListing|Place|Accommodation/i.test(
          x,
        ),
      ) && !!c.address?.streetAddress
    );
  });

  if (productish?.address?.streetAddress) {
    const a = productish.address;
    const photos = ([] as string[]).concat(productish.image ?? []).slice(0, 10);
    return {
      source,
      address: decodeEntities(a.streetAddress ?? ''),
      city: decodeEntities(a.addressLocality ?? ''),
      state: a.addressRegion ?? '',
      zip: a.postalCode ?? '',
      price: priceToCents(productish.offers?.price ?? productish.price),
      beds: productish.numberOfBedrooms ?? productish.numberOfRooms,
      baths: productish.numberOfBathroomsTotal,
      sqft: productish.floorSize?.value,
      description: productish.description
        ? decodeEntities(productish.description).slice(0, 2000)
        : undefined,
      photoUrls: photos,
      listingUrl: url,
    };
  }

  // ── 2. OpenGraph fallback: "123 Main St, City, ST 12345" in og:title ───────
  const title =
    metaContent(html, 'og:title') ??
    html.match(/<title>([^<]*)<\/title>/i)?.[1];
  if (!title) return null;
  const m = decodeEntities(title).match(
    /^(.+?),\s*([^,]+?),\s*([A-Z]{2})\b\s*(\d{5})?/,
  );
  if (!m) return null;

  const ogImage = metaContent(html, 'og:image');
  const ogDesc = metaContent(html, 'og:description');
  const priceMatch = (ogDesc ?? '').match(/\$\s?([\d,]{4,})/);

  return {
    source,
    address: m[1].trim(),
    city: m[2].trim(),
    state: m[3],
    zip: m[4] ?? '',
    price: priceMatch ? priceToCents(priceMatch[1]) : undefined,
    description: ogDesc ? decodeEntities(ogDesc).slice(0, 2000) : undefined,
    photoUrls: ogImage ? [ogImage] : [],
    listingUrl: url,
  };
}

/** Fetch a listing page and extract capture data. */
export async function captureFromUrl(
  url: string,
): Promise<ListingCapturePayload | null> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers: {
      // Plain browser UA — some listing sites block default fetch UAs outright.
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!res.ok) throw new Error(`page_fetch_failed_${res.status}`);
  const html = await res.text();
  return extractListingFromHtml(html, url);
}
