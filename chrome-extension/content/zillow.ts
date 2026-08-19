/**
 * Zillow listing extractor — Task 32
 *
 * Reads listing data from Zillow's Next.js __NEXT_DATA__ hydration payload
 * (most reliable source — avoids scraping brittle DOM classes).
 * Falls back to DOM extraction if payload is unavailable.
 */
import { injectCaptureButton, type ListingData } from '../utils/overlay.js';

function parsePriceCents(raw: unknown): number | undefined {
  if (typeof raw === 'number') return Math.round(raw * 100);
  if (typeof raw === 'string') {
    const n = parseInt(raw.replace(/[^0-9]/g, ''), 10);
    return isNaN(n) ? undefined : n * 100;
  }
  return undefined;
}

type ZillowRecord = Record<string, any>;

function parseJsonObject(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Zillow has moved the property payload between several Next.js cache shapes,
 * and gdpClientCache is frequently JSON encoded a second time. Walk the small
 * hydration subtree instead of depending on one cache key.
 */
export function findZillowProperty(raw: unknown): ZillowRecord | null {
  const root = parseJsonObject(raw);
  if (!root || typeof root !== 'object') return null;

  const queue: unknown[] = [root];
  const seen = new Set<object>();
  let visited = 0;
  while (queue.length > 0 && visited < 5_000) {
    const current = parseJsonObject(queue.shift());
    if (!current || typeof current !== 'object') continue;
    if (seen.has(current as object)) continue;
    seen.add(current as object);
    visited += 1;

    const candidate = current as ZillowRecord;
    const address = candidate.address;
    const hasAddress =
      typeof address === 'string' ||
      (address &&
        typeof address === 'object' &&
        typeof address.streetAddress === 'string');
    const looksLikeProperty =
      hasAddress &&
      (candidate.zpid != null ||
        candidate.price != null ||
        candidate.bedrooms != null ||
        Array.isArray(candidate.photos));
    if (looksLikeProperty) return candidate;

    for (const value of Object.values(candidate)) {
      if (value && (typeof value === 'object' || typeof value === 'string')) {
        queue.push(value);
      }
    }
  }
  return null;
}

// Zillow is a client-routed SPA: clicking through from one listing to
// another changes window.location without a full page load, so the content
// script (and this module) never re-runs. __NEXT_DATA__ is a Next.js
// hydration artifact written once at the ORIGINAL full page load — Zillow's
// client router updates the visible page but does not rewrite that script
// tag, so after any in-app navigation it silently holds the PREVIOUS
// listing's data. Pin the URL this module instance actually loaded for, so
// extractZillow() can tell when __NEXT_DATA__ has gone stale and must not be
// trusted, even though it's still present and still parses cleanly.
const loadedForUrl = typeof window !== 'undefined' ? window.location.href : '';

export interface PhotoEntry {
  url: string;
  caption: string | null;
}

/**
 * Pairs each raw Zillow photo object with its url + caption (if any), then
 * filters to real http(s) image URLs, dedupes by url, and caps at 10 —
 * keeping url/caption paired through every step so a later split into
 * parallel photoUrls/photoCaptions arrays stays aligned by construction.
 * Exact caption key is unconfirmed as of writing, so several likely
 * candidates are checked rather than guessing a single one.
 */
export function extractPhotoEntries(rawPhotos: unknown): PhotoEntry[] {
  const list = Array.isArray(rawPhotos) ? rawPhotos : [];
  return list
    .map((p: any) => {
      const url =
        typeof p === 'string'
          ? p
          : (p?.url ?? p?.mixedSources?.jpeg?.at(-1)?.url);
      const rawCaption =
        p && typeof p === 'object'
          ? (p.caption ?? p.text ?? p.description ?? p.roomLabel ?? p.label)
          : null;
      const caption =
        typeof rawCaption === 'string' && rawCaption.trim()
          ? rawCaption.trim()
          : null;
      return { url, caption };
    })
    .filter(
      (e: { url: unknown }): e is PhotoEntry =>
        typeof e.url === 'string' && /^https?:\/\//i.test(e.url),
    )
    .filter(
      (e: PhotoEntry, i: number, all: PhotoEntry[]) =>
        all.findIndex((x) => x.url === e.url) === i,
    )
    .slice(0, 10);
}

export function extractZillow(): ListingData | null {
  // ── Try Next.js hydration data first (only while it's still trustworthy) ──
  try {
    const el =
      window.location.href === loadedForUrl
        ? document.getElementById('__NEXT_DATA__')
        : null;
    if (el) {
      const data = JSON.parse(el.textContent ?? '{}');
      // Navigate to property details (path varies by page type)
      const pageProps = data?.props?.pageProps;
      const detail = findZillowProperty([
        pageProps?.gdpClientCache,
        pageProps?.initialData,
        pageProps?.initialReduxState,
        pageProps,
      ]);

      if (detail?.address) {
        const address = detail.address;
        const photoEntries = extractPhotoEntries(detail.photos ?? detail.images);
        const photoUrls = photoEntries.map((e) => e.url);
        const photoCaptions = photoEntries.map((e) => e.caption);
        return {
          source: 'zillow',
          mlsNumber: detail.mlsid ?? detail.zestimate?.mlsNumber,
          address: address?.streetAddress ?? address,
          city: address?.city ?? '',
          state: address?.state ?? '',
          zip: address?.zipcode ?? '',
          price: parsePriceCents(detail.price ?? detail.zestimate?.amount),
          beds: detail.bedrooms ?? detail.beds,
          baths: detail.bathrooms ?? detail.baths,
          sqft: detail.livingArea ?? detail.floorSize,
          lotSqft: detail.lotSize,
          yearBuilt: detail.yearBuilt,
          propertyType: detail.homeType?.toLowerCase(),
          status: detail.homeStatus?.toLowerCase(),
          daysOnMarket: detail.daysOnZillow,
          description: detail.description,
          photoUrls,
          photoCaptions,
          agentName: detail.attributionInfo?.agentName,
          agentPhone: detail.attributionInfo?.agentPhoneNumber,
          listingUrl: window.location.href,
        };
      }
    }
  } catch {
    /* fall through to DOM */
  }

  // ── DOM fallback ──────────────────────────────────────────────────────────
  const priceEl = document.querySelector('[data-testid="price"]');
  const addrEl =
    document.querySelector('[data-testid="home-details-summary-headline"]') ??
    document.querySelector('h1');
  const bedsEl = document.querySelector(
    '[data-testid="bed-bath-item"]:first-child',
  );
  const bathsEl = document.querySelector(
    '[data-testid="bed-bath-item"]:last-child',
  );
  const sqftEl = document.querySelector('[data-testid="floor-space"]');

  if (!addrEl) return null;

  // Parse "123 Main St, City, ST 12345"
  const addrText = addrEl.textContent?.trim() ?? '';
  const addrMatch = addrText.match(/^(.+),\s*(.+),\s*([A-Z]{2})\s*(\d{5})/);

  return {
    source: 'zillow',
    address: addrMatch?.[1] ?? addrText,
    city: addrMatch?.[2] ?? '',
    state: addrMatch?.[3] ?? '',
    zip: addrMatch?.[4] ?? '',
    price: parsePriceCents(priceEl?.textContent),
    beds: parseFloat(bedsEl?.textContent ?? '') || undefined,
    baths: parseFloat(bathsEl?.textContent ?? '') || undefined,
    sqft:
      parseInt(sqftEl?.textContent?.replace(/[^0-9]/g, '') ?? '', 10) ||
      undefined,
    listingUrl: window.location.href,
    photoUrls: Array.from(
      document.querySelectorAll('img[src*="photos.zillowstatic"]'),
    )
      .slice(0, 10)
      .map((img) => (img as HTMLImageElement).src),
  };
}

// Inject capture button once DOM is ready
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () =>
      injectCaptureButton(extractZillow),
    );
  } else {
    injectCaptureButton(extractZillow);
  }
}
