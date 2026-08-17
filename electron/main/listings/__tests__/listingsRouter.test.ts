import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startApiServer, type RunningApiServer } from '../../server';
import { createListingsRouter } from '../router';
import { ListingAdService } from '../adService';
import { ComplianceGuard } from '../complianceGuard';
import type { ContentService } from '../../content';
import type { ListingStore, ListListingsParams } from '../listingStore';
import type { ListingCapturePayload, PropertyListingSummary } from '../types';

/**
 * End-to-end router test over real Express + bearer auth, using an in-memory
 * store (the TypeORM store is covered separately under the Electron ABI).
 */
class InMemoryListingStore implements ListingStore {
  private rows = new Map<string, PropertyListingSummary>();
  private seq = 0;
  private guard = new ComplianceGuard();

  async capture(p: ListingCapturePayload): Promise<PropertyListingSummary> {
    const existing = p.listingUrl
      ? [...this.rows.values()].find((r) => r.listingUrl === p.listingUrl)
      : undefined;
    const compliance = this.guard.check(p.description ?? '');
    const row: PropertyListingSummary = {
      id: existing?.id ?? `lst-${++this.seq}`,
      source: p.source,
      mlsNumber: p.mlsNumber ?? null,
      address: p.address,
      city: p.city,
      state: p.state,
      zip: p.zip ?? '',
      price: p.price ?? null,
      beds: p.beds ?? null,
      baths: p.baths ?? null,
      sqft: p.sqft ?? null,
      lotSqft: p.lotSqft ?? null,
      yearBuilt: p.yearBuilt ?? null,
      propertyType: p.propertyType ?? null,
      status: p.status ?? 'active',
      daysOnMarket: p.daysOnMarket ?? null,
      description: p.description ?? null,
      photoUrls: p.photoUrls ?? [],
      agentName: p.agentName ?? null,
      agentPhone: p.agentPhone ?? null,
      agentEmail: p.agentEmail ?? null,
      listingUrl: p.listingUrl ?? null,
      complianceOk: compliance.ok,
      complianceFlags: compliance.flags,
      capturedAt: new Date().toISOString(),
    };
    this.rows.set(row.id, row);
    return row;
  }

  async list(_params?: ListListingsParams) {
    const listings = [...this.rows.values()];
    return { listings, total: listings.length };
  }

  async get(id: string) {
    return this.rows.get(id) ?? null;
  }

  async remove(id: string) {
    return this.rows.delete(id);
  }
}

const noProviderContent = {
  generate: () => Promise.reject(new Error('No AI provider configured.')),
} as unknown as ContentService;

let api: RunningApiServer;
let openApi: RunningApiServer;
const store = new InMemoryListingStore();

beforeAll(async () => {
  const adService = new ListingAdService(store, noProviderContent);
  // Authed surface (as mounted by the MAS runtime)
  api = await startApiServer({
    token: 'listing-test-token',
    routes: [
      { path: '/listings', router: createListingsRouter(store, { adService }) },
    ],
  });
  // Capture-server shape: router WITHOUT adService
  openApi = await startApiServer({
    token: 'unused',
    routes: [{ path: '/listings', router: createListingsRouter(store) }],
  });
});

afterAll(async () => {
  await api.close();
  await openApi.close();
});

const auth = {
  Authorization: 'Bearer listing-test-token',
  'Content-Type': 'application/json',
};

describe('listings router over HTTP', () => {
  let listingId = '';

  it('captures a listing', async () => {
    const res = await fetch(`${api.url}/api/listings/capture`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        source: 'zillow',
        address: '77 Lake View Dr',
        city: 'Houston',
        state: 'TX',
        price: 39900000,
        beds: 3,
        listingUrl: 'https://www.zillow.com/homedetails/77-lake-view',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { listing: PropertyListingSummary };
    listingId = body.listing.id;
    expect(body.listing.complianceOk).toBe(true);
  });

  it('rejects an invalid capture payload with 400', async () => {
    const res = await fetch(`${api.url}/api/listings/capture`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ source: 'zillow', address: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('generates a listing ad (template fallback) with compliance results', async () => {
    const res = await fetch(
      `${api.url}/api/listings/${listingId}/generate-ad`,
      {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({
          platforms: ['facebook', 'instagram'],
          highlight: 'lake views',
        }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      provider: string;
      items: Array<{
        platform: string;
        body: string;
        complianceOk: boolean;
        hashtags: string[];
      }>;
    };
    expect(body.provider).toBe('template');
    expect(body.items).toHaveLength(2);
    expect(body.items[0].body).toContain('77 Lake View Dr');
    expect(body.items[0].body).toContain('lake views');
    expect(body.items.every((i) => i.complianceOk)).toBe(true);
  });

  it('404s ad generation for an unknown listing', async () => {
    const res = await fetch(`${api.url}/api/listings/nope/generate-ad`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ platforms: ['facebook'] }),
    });
    expect(res.status).toBe(404);
  });

  it('400s ad generation with an invalid platform', async () => {
    const res = await fetch(
      `${api.url}/api/listings/${listingId}/generate-ad`,
      {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ platforms: ['myspace'] }),
      },
    );
    expect(res.status).toBe(400);
  });

  it('accepts Video Producer fields (ctaText/narrationScript/photoOrder) on generate-video', async () => {
    let received: unknown;
    const videoService = {
      generateVideo: (id: string, opts: unknown) => {
        received = opts;
        return Promise.resolve({
          listingId: id,
          path: '/tmp/reel.mp4',
          durationSeconds: 10,
          photosUsed: 1,
          narrated: false,
        });
      },
    };
    const videoApi = await startApiServer({
      token: 'video-test-token',
      routes: [
        {
          path: '/listings',
          router: createListingsRouter(store, { videoService: videoService as any }),
        },
      ],
    });
    try {
      const res = await fetch(
        `${videoApi.url}/api/listings/${listingId}/generate-video`,
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer video-test-token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ctaText: 'Open house Saturday 1-3pm',
            narrationScript: 'Custom voiceover.',
            photoOrder: [2, 0, 1],
          }),
        },
      );
      expect(res.status).toBe(200);
      expect(received).toMatchObject({
        ctaText: 'Open house Saturday 1-3pm',
        narrationScript: 'Custom voiceover.',
        photoOrder: [2, 0, 1],
      });
    } finally {
      await videoApi.close();
    }
  });

  it('returns 503 for generate-ad on the capture-server shape (no adService)', async () => {
    const res = await fetch(
      `${openApi.url}/api/listings/${listingId}/generate-ad`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer unused',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ platforms: ['facebook'] }),
      },
    );
    expect(res.status).toBe(503);
  });
});

// Regression test for the 2026-08-14 "didn't autopopulate" bug: a listing
// captured by the extension landed in the DB correctly, but the already-open
// Zillow Scraper page never learned about it (it only fetches once, on
// mount). onCaptured is the hook the main process uses to push a live
// update — verify it actually fires on the extension's capture route
// (/capture — the paste-URL /capture-url route calls the exact same
// store.capture()+onCaptured pair, not separately tested here since
// exercising it deterministically needs a real network fetch, unlike this).
describe('onCaptured hook', () => {
  it('fires after a successful /capture', async () => {
    const captured: PropertyListingSummary[] = [];
    const store2 = new InMemoryListingStore();
    const api2 = await startApiServer({
      token: 'hook-token',
      routes: [
        {
          path: '/listings',
          router: createListingsRouter(store2, {
            onCaptured: (listing) => captured.push(listing),
          }),
        },
      ],
    });
    try {
      const res = await fetch(`${api2.url}/api/listings/capture`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer hook-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          source: 'zillow',
          address: '9 Hook Ln',
          city: 'Dallas',
          state: 'TX',
          listingUrl: 'https://www.zillow.com/homedetails/9-hook-ln',
        }),
      });
      expect(res.status).toBe(201);
      expect(captured).toHaveLength(1);
      expect(captured[0].address).toBe('9 Hook Ln');
    } finally {
      await api2.close();
    }
  });

  it('does not throw when onCaptured is omitted', async () => {
    const store2 = new InMemoryListingStore();
    const api2 = await startApiServer({
      token: 'hook-token-3',
      routes: [{ path: '/listings', router: createListingsRouter(store2) }],
    });
    try {
      const res = await fetch(`${api2.url}/api/listings/capture`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer hook-token-3',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          source: 'manual',
          address: '1 No Hook Way',
          city: 'Reno',
          state: 'NV',
        }),
      });
      expect(res.status).toBe(201);
    } finally {
      await api2.close();
    }
  });
});
