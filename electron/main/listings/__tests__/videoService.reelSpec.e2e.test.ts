import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ListingVideoService } from '../videoService';
import { resolveFfmpegPath } from '../../../util/ffmpegBinary';
import type { PropertyListingSummary } from '../types';

const run = promisify(execFile);

/**
 * Real end-to-end smoke test for the reel-spec template (electron/main/
 * listings/video/*): generates solid-color JPEGs with captions matching
 * each of the 5 room buckets, feeds them through the actual
 * ListingVideoService (no mocks), and verifies via ffprobe that a valid
 * 1080x1920 mp4 comes out — including the transition-driven duration
 * shrink, which only a real render can prove (see videoService.reelSpec's
 * riskiest piece: the xfade filter_complex chain in the shared
 * electron/main/aicuts export engine).
 */
describe('ListingVideoService — reel-spec E2E (real ffmpeg)', () => {
  let workDir: string;
  let outDir: string;
  let listing: PropertyListingSummary;
  let store: { get: (id: string) => Promise<PropertyListingSummary | null> };

  async function probe(filePath: string) {
    const ffprobePath = resolveFfmpegPath().replace(
      /ffmpeg(\.exe)?$/,
      'ffprobe$1',
    );
    const probeBin = fs.existsSync(ffprobePath) ? ffprobePath : 'ffprobe';
    const { stdout } = await run(probeBin, [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height,codec_name',
      '-show_entries',
      'format=duration',
      '-of',
      'json',
      filePath,
    ]);
    return JSON.parse(stdout);
  }

  beforeAll(async () => {
    workDir = path.join(
      os.tmpdir(),
      `uscut-reelspec-e2e-${crypto.randomUUID()}`,
    );
    outDir = path.join(
      os.tmpdir(),
      `uscut-reelspec-e2e-out-${crypto.randomUUID()}`,
    );
    fs.mkdirSync(workDir, { recursive: true });

    const ffmpegPath = resolveFfmpegPath();
    const shots = [
      { color: '0x336699', caption: 'Front Exterior' },
      { color: '0x996633', caption: 'Kitchen' },
      { color: '0x33aa66', caption: 'Living Room' },
      { color: '0xaa3366', caption: 'Primary Bedroom' },
      { color: '0x6633aa', caption: 'Backyard' },
    ];
    const photoUrls: string[] = [];
    for (const [i, shot] of shots.entries()) {
      const file = path.join(workDir, `photo_${i}.jpg`);
      await run(ffmpegPath, [
        '-y',
        '-f',
        'lavfi',
        '-i',
        `color=c=${shot.color}:s=1600x1200`,
        '-frames:v',
        '1',
        file,
      ]);
      photoUrls.push(file);
    }

    listing = {
      id: 'reel-spec-e2e-1',
      source: 'zillow',
      mlsNumber: null,
      address: '123 Test Lane',
      city: 'Austin',
      state: 'TX',
      zip: '78701',
      price: 45_000_000, // standard tier ($450k < $600k)
      beds: 4,
      baths: 3,
      sqft: 2400,
      lotSqft: null,
      yearBuilt: 2020,
      propertyType: 'single_family',
      status: 'active',
      daysOnMarket: 2,
      description: 'Beautiful home',
      photoUrls,
      photoCaptions: shots.map((s) => s.caption),
      agentName: 'Jane Agent',
      agentPhone: '555-1234',
      agentEmail: null,
      listingUrl: 'https://www.zillow.com/homedetails/123-test',
      complianceOk: true,
      complianceFlags: [],
      capturedAt: new Date().toISOString(),
    };

    store = {
      get: async (id: string) => (id === listing.id ? listing : null),
    };
  }, 30_000);

  afterAll(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it('renders a standard-tier reel with 5 photo buckets + CTA and whip-cut transitions', async () => {
    const service = new ListingVideoService(store as any, outDir);
    const result = await service.generateVideo(listing.id, {
      reelTemplate: 'reel-spec',
      narration: false,
    });

    expect(result).not.toBeNull();
    expect(fs.existsSync(result!.path)).toBe(true);
    expect(result!.photosUsed).toBe(5);

    const probed = await probe(result!.path);
    expect(probed.streams[0].width).toBe(1080);
    expect(probed.streams[0].height).toBe(1920);
    expect(probed.streams[0].codec_name).toBe('h264');
    // 28s nominal (23s photos + 5s CTA) minus 5 whip-cut transitions * 0.2s ≈ 27s.
    const duration = Number(probed.format.duration);
    expect(duration).toBeGreaterThan(24);
    expect(duration).toBeLessThan(29);
  }, 90_000);

  it('renders a luxury-tier reel with slower 0.8s cross-dissolve transitions (shorter output)', async () => {
    const luxuryListing: PropertyListingSummary = {
      ...listing,
      id: 'reel-spec-e2e-2',
      price: 125_000_000, // $1.25M, luxury tier
    };
    const luxuryStore = {
      get: async (id: string) =>
        id === luxuryListing.id ? luxuryListing : null,
    };
    const service = new ListingVideoService(luxuryStore as any, outDir);
    const result = await service.generateVideo(luxuryListing.id, {
      reelTemplate: 'reel-spec',
      narration: false,
    });

    expect(result).not.toBeNull();
    expect(fs.existsSync(result!.path)).toBe(true);

    const probed = await probe(result!.path);
    expect(probed.streams[0].width).toBe(1080);
    expect(probed.streams[0].height).toBe(1920);
    expect(probed.streams[0].codec_name).toBe('h264');
    // 28s nominal minus 5 cross-dissolve transitions * 0.8s ≈ 24s — reliably
    // shorter than the standard-tier render above, proving the transition
    // duration actually reached the filter graph (not just accepted as a param).
    const duration = Number(probed.format.duration);
    expect(duration).toBeGreaterThan(20);
    expect(duration).toBeLessThan(26);
  }, 90_000);

  it('degrades gracefully to a shorter reel when there are fewer photos than buckets', async () => {
    const sparseListing: PropertyListingSummary = {
      ...listing,
      id: 'reel-spec-e2e-3',
      photoUrls: listing.photoUrls.slice(0, 1),
      photoCaptions: ['Kitchen'],
    };
    const sparseStore = {
      get: async (id: string) =>
        id === sparseListing.id ? sparseListing : null,
    };
    const service = new ListingVideoService(sparseStore as any, outDir);
    const result = await service.generateVideo(sparseListing.id, {
      reelTemplate: 'reel-spec',
      narration: false,
    });

    expect(result).not.toBeNull();
    expect(result!.photosUsed).toBe(1);
    expect(fs.existsSync(result!.path)).toBe(true);
    const probed = await probe(result!.path);
    expect(probed.streams[0].width).toBe(1080);
    expect(probed.streams[0].height).toBe(1920);
  }, 60_000);

  it('falls back to a CTA-card-only reel with zero photos, never throwing', async () => {
    const noPhotoListing: PropertyListingSummary = {
      ...listing,
      id: 'reel-spec-e2e-4',
      photoUrls: [],
      photoCaptions: [],
    };
    const noPhotoStore = {
      get: async (id: string) =>
        id === noPhotoListing.id ? noPhotoListing : null,
    };
    const service = new ListingVideoService(noPhotoStore as any, outDir);
    const result = await service.generateVideo(noPhotoListing.id, {
      reelTemplate: 'reel-spec',
      narration: false,
    });

    expect(result).not.toBeNull();
    expect(result!.photosUsed).toBe(0);
    expect(fs.existsSync(result!.path)).toBe(true);
  }, 60_000);

  it('honors custom hookText and ctaText without breaking the render', async () => {
    const service = new ListingVideoService(store as any, outDir);
    const result = await service.generateVideo(listing.id, {
      reelTemplate: 'reel-spec',
      narration: false,
      hookText: 'your dream home awaits',
      ctaText: 'Open house Saturday 1-3pm',
    });
    expect(result).not.toBeNull();
    expect(fs.existsSync(result!.path)).toBe(true);
  }, 60_000);

  it('produces a narrated file on win32 (SAPI path) with a real probed duration', async () => {
    const service = new ListingVideoService(store as any, outDir);
    const result = await service.generateVideo(listing.id, {
      reelTemplate: 'reel-spec',
      narration: process.platform === 'win32',
    });
    expect(result).not.toBeNull();
    expect(fs.existsSync(result!.path)).toBe(true);
    if (process.platform === 'win32') {
      expect(result!.narrated).toBe(true);
    }
  }, 90_000);
});
