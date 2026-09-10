import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Settings, type SettingsStore } from '../../settings/settings';
import type { ListingStore } from '../listingStore';
import type { PropertyListingSummary } from '../types';
import { ListingFilesService, deriveFolderName } from '../listingFiles';

function mapStore(): SettingsStore {
  const m = new Map<string, unknown>();
  return { get: (k) => m.get(k), set: (k, v) => void m.set(k, v) };
}

function fakeListing(
  overrides: Partial<PropertyListingSummary> = {},
): PropertyListingSummary {
  return {
    id: 'lst-1',
    source: 'zillow',
    mlsNumber: null,
    address: '99 Bates Ave NE',
    city: 'Atlanta',
    state: 'GA',
    zip: '30317',
    price: 45000000,
    beds: 3,
    baths: 2.5,
    sqft: 2100,
    lotSqft: null,
    yearBuilt: null,
    propertyType: null,
    status: 'active',
    daysOnMarket: 4,
    description: 'A lovely Kirkwood home.',
    photoUrls: [],
    photoCaptions: [],
    agentName: 'Jane Agent',
    agentPhone: '555-1234',
    agentEmail: null,
    listingUrl: 'https://www.zillow.com/homedetails/99-bates',
    complianceOk: true,
    complianceFlags: [],
    capturedAt: new Date().toISOString(),
    filesFolder: null,
    ...overrides,
  };
}

describe('deriveFolderName', () => {
  it('takes the house number and first street word', () => {
    expect(deriveFolderName('99 Bates Ave NE')).toBe('99 Bates');
  });

  it('falls back to the sanitized full address when there is no house number', () => {
    expect(deriveFolderName('Lot 4, Sunset Ridge')).toBe('Lot 4, Sunset Ridge');
  });

  it('strips Windows-illegal filename characters', () => {
    expect(deriveFolderName('99 Bates: Unit "A"')).toBe('99 Bates');
  });
});

describe('ListingFilesService', () => {
  let root: string;
  let settings: Settings;
  let rows: Map<string, PropertyListingSummary>;
  let store: ListingStore;
  let service: ListingFilesService;

  beforeEach(() => {
    root = path.join(os.tmpdir(), `uscut-listingfiles-${crypto.randomUUID()}`);
    settings = new Settings(mapStore());
    settings.setZillowScraperDir(root);
    rows = new Map();
    store = {
      capture: () => Promise.reject(new Error('not used')),
      list: () => Promise.reject(new Error('not used')),
      get: async (id) => rows.get(id) ?? null,
      remove: () => Promise.reject(new Error('not used')),
      setFilesFolder: async (id, folder) => {
        const row = rows.get(id);
        if (row) rows.set(id, { ...row, filesFolder: folder });
      },
    };
    service = new ListingFilesService(settings, store);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('creates a folder named from the address and writes description.docx', async () => {
    const listing = fakeListing();
    rows.set(listing.id, listing);

    await service.syncListingFiles(listing);

    const expectedFolder = path.join(root, '99 Bates');
    expect(fs.existsSync(expectedFolder)).toBe(true);
    expect(fs.existsSync(path.join(expectedFolder, 'description.docx'))).toBe(
      true,
    );
    expect(rows.get(listing.id)?.filesFolder).toBe(expectedFolder);
  });

  it('reuses the persisted filesFolder on a plain re-capture instead of creating a duplicate', async () => {
    const listing = fakeListing();
    rows.set(listing.id, listing);
    await service.syncListingFiles(listing);
    const folderAfterFirst = rows.get(listing.id)!.filesFolder!;

    // Simulate a re-capture of the same row (same id, filesFolder already set).
    const recaptured = {
      ...rows.get(listing.id)!,
      description: 'Updated copy.',
    };
    rows.set(listing.id, recaptured);
    await service.syncListingFiles(recaptured);

    expect(rows.get(listing.id)?.filesFolder).toBe(folderAfterFirst);
    expect(fs.existsSync(path.join(root, '99 Bates (2)'))).toBe(false);
  });

  it('suffixes the folder name on collision with a different listing', async () => {
    const first = fakeListing({ id: 'lst-1' });
    const second = fakeListing({ id: 'lst-2' });
    rows.set(first.id, first);
    rows.set(second.id, second);

    await service.syncListingFiles(first);
    await service.syncListingFiles(second);

    expect(rows.get('lst-1')?.filesFolder).toBe(path.join(root, '99 Bates'));
    expect(rows.get('lst-2')?.filesFolder).toBe(
      path.join(root, '99 Bates (2)'),
    );
  });

  it('tolerates bogus photo URLs without failing the whole sync', async () => {
    // A non-http string (rejected immediately) plus an unroutable loopback
    // port (connection refused fast, no real network call) — both must be
    // skipped without throwing.
    const listing = fakeListing({
      photoUrls: ['not-a-real-url', 'http://127.0.0.1:1/nope.jpg'],
    });
    rows.set(listing.id, listing);

    await expect(service.syncListingFiles(listing)).resolves.toBeUndefined();

    const folder = rows.get(listing.id)!.filesFolder!;
    expect(fs.existsSync(path.join(folder, 'description.docx'))).toBe(true);
  });

  it('moves the folder into Archive on delete, leaving nothing behind', async () => {
    const listing = fakeListing();
    rows.set(listing.id, listing);
    await service.syncListingFiles(listing);
    const folder = rows.get(listing.id)!.filesFolder!;

    await service.archiveListingFiles(rows.get(listing.id)!);

    expect(fs.existsSync(folder)).toBe(false);
    expect(fs.existsSync(path.join(root, 'Archive', '99 Bates'))).toBe(true);
  });

  it('suffixes on collision when archiving the same folder name twice', async () => {
    const first = fakeListing({ id: 'lst-1' });
    rows.set(first.id, first);
    await service.syncListingFiles(first);
    await service.archiveListingFiles(rows.get('lst-1')!);

    // A fresh capture (new row, no filesFolder) reuses the same derived name.
    const second = fakeListing({ id: 'lst-2' });
    rows.set(second.id, second);
    await service.syncListingFiles(second);
    await service.archiveListingFiles(rows.get('lst-2')!);

    expect(fs.existsSync(path.join(root, 'Archive', '99 Bates'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'Archive', '99 Bates (2)'))).toBe(
      true,
    );
  });

  it('no-ops archiving when filesFolder is unset', async () => {
    const listing = fakeListing({ filesFolder: null });
    await expect(service.archiveListingFiles(listing)).resolves.toBeUndefined();
  });
});
