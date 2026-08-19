import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { DataSource } from 'typeorm';
import { PropertyListingModel } from '../../../db/models/mas';
import { TypeOrmListingStore } from '../listingStore';
import type { ListingCapturePayload } from '../types';

// better-sqlite3 is rebuilt against Electron's ABI (electron-rebuild), so it
// won't load under plain node. Skip when the ABI doesn't match (same pattern
// as electron/db/__tests__/masSchema.test.ts).
const nativeLoads = (() => {
  try {
    const Database = createRequire(import.meta.url)('better-sqlite3');
    new Database(':memory:').close();
    return true;
  } catch {
    return false;
  }
})();

let ds: DataSource;
let store: TypeOrmListingStore;

const zillowCapture: ListingCapturePayload = {
  source: 'zillow',
  address: '123 Main St',
  city: 'Houston',
  state: 'TX',
  zip: '77002',
  price: 42500000, // $425,000 in cents
  beds: 3,
  baths: 2,
  sqft: 1850,
  description: 'Charming 3/2 with updated kitchen and large backyard.',
  photoUrls: ['https://photos.example.com/1.jpg'],
  photoCaptions: ['Kitchen'],
  listingUrl: 'https://www.zillow.com/homedetails/123-main-st',
};

describe.skipIf(!nativeLoads)('TypeOrmListingStore', () => {
  beforeAll(async () => {
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      synchronize: true,
      entities: [PropertyListingModel],
    });
    await ds.initialize();
    store = new TypeOrmListingStore(ds);
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  it('captures a listing and runs compliance on the description', async () => {
    const listing = await store.capture(zillowCapture);
    expect(listing.id).toBeTruthy();
    expect(listing.address).toBe('123 Main St');
    expect(listing.price).toBe(42500000);
    expect(listing.complianceOk).toBe(true);
    expect(listing.complianceFlags).toHaveLength(0);
    expect(listing.photoUrls).toEqual(['https://photos.example.com/1.jpg']);
    expect(listing.photoCaptions).toEqual(['Kitchen']);
  });

  it('dedupes re-captures of the same listingUrl (update, not duplicate)', async () => {
    const updated = await store.capture({
      ...zillowCapture,
      price: 41900000,
      status: 'pending',
    });
    expect(updated.price).toBe(41900000);
    expect(updated.status).toBe('pending');
    const { total } = await store.list();
    expect(total).toBe(1);
  });

  it('flags discriminatory listing descriptions', async () => {
    const flagged = await store.capture({
      ...zillowCapture,
      listingUrl: 'https://www.zillow.com/homedetails/456-oak-ave',
      address: '456 Oak Ave',
      description: 'Lovely home, adults only building, no kids allowed.',
    });
    expect(flagged.complianceOk).toBe(false);
    expect(flagged.complianceFlags.some((f) => f.rule === 'FH-FAMILIAL')).toBe(
      true,
    );
  });

  it('lists with filters and pagination', async () => {
    await store.capture({
      source: 'manual',
      address: '9 Pine Ct',
      city: 'Austin',
      state: 'TX',
      listingUrl: 'https://someagentsite.com/listing/9-pine-ct',
    });

    const all = await store.list();
    expect(all.total).toBe(3);

    const manualOnly = await store.list({ source: 'manual' });
    expect(manualOnly.total).toBe(1);
    expect(manualOnly.listings[0].address).toBe('9 Pine Ct');

    const houston = await store.list({ city: 'Hous' });
    expect(houston.total).toBe(1);

    const paged = await store.list({ limit: 2 });
    expect(paged.listings).toHaveLength(2);
    expect(paged.total).toBe(3);
  });

  it('gets and removes a listing by id', async () => {
    const { listings } = await store.list({ source: 'manual' });
    const id = listings[0].id;

    const fetched = await store.get(id);
    expect(fetched?.address).toBe('9 Pine Ct');

    expect(await store.remove(id)).toBe(true);
    expect(await store.get(id)).toBeNull();
    expect(await store.remove(id)).toBe(false);
  });
});
