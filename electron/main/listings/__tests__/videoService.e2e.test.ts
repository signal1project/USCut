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
 * Real end-to-end smoke test: generates two solid-color JPEGs with ffmpeg,
 * feeds them through the actual ListingVideoService (no mocks), and
 * verifies via ffprobe that a valid 1080x1920 mp4 comes out the other end.
 * Uses SAPI narration on Windows and verifies it does not truncate the visual
 * timeline. Other platforms exercise the silent fallback.
 */
describe('ListingVideoService — real ffmpeg E2E', () => {
  let workDir: string;
  let outDir: string;
  let store: { get: (id: string) => Promise<PropertyListingSummary | null> };

  const listing: PropertyListingSummary = {
    id: 'e2e-listing-1',
    source: 'zillow',
    mlsNumber: null,
    address: '123 Test Lane',
    city: 'Austin',
    state: 'TX',
    zip: '78701',
    price: 45000000,
    beds: 4,
    baths: 3,
    sqft: 2400,
    lotSqft: null,
    yearBuilt: 2020,
    propertyType: 'single_family',
    status: 'active',
    daysOnMarket: 2,
    description: 'Beautiful home',
    photoUrls: [],
    agentName: 'Jane Agent',
    agentPhone: '555-1234',
    agentEmail: null,
    listingUrl: 'https://www.zillow.com/homedetails/123-test',
    complianceOk: true,
    complianceFlags: [],
    capturedAt: new Date().toISOString(),
  };

  beforeAll(async () => {
    workDir = path.join(os.tmpdir(), `uscut-e2e-${crypto.randomUUID()}`);
    outDir = path.join(os.tmpdir(), `uscut-e2e-out-${crypto.randomUUID()}`);
    fs.mkdirSync(workDir, { recursive: true });

    const ffmpegPath = resolveFfmpegPath();
    const colors = ['0x2255aa', '0xaa5522'];
    const photoFiles: string[] = [];
    for (const [i, color] of colors.entries()) {
      const file = path.join(workDir, `photo_${i}.jpg`);
      await run(ffmpegPath, [
        '-y',
        '-f',
        'lavfi',
        '-i',
        `color=c=${color}:s=1600x1200`,
        '-frames:v',
        '1',
        file,
      ]);
      photoFiles.push(file);
    }
    listing.photoUrls = photoFiles;

    store = {
      get: async (id: string) => (id === listing.id ? listing : null),
    };
  }, 30_000);

  afterAll(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it('produces a valid vertical mp4 from real listing photos', async () => {
    const service = new ListingVideoService(store as any, outDir);
    const result = await service.generateVideo(listing.id, {
      maxPhotos: 2,
      secondsPerPhoto: 2,
      narration: process.platform === 'win32',
    });

    expect(result).not.toBeNull();
    expect(result!.photosUsed).toBe(2);
    expect(fs.existsSync(result!.path)).toBe(true);
    expect(fs.statSync(result!.path).size).toBeGreaterThan(1000);

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
      result!.path,
    ]);
    const probe = JSON.parse(stdout);
    expect(probe.streams[0].width).toBe(1080);
    expect(probe.streams[0].height).toBe(1920);
    expect(probe.streams[0].codec_name).toBe('h264');
    expect(Number(probe.format.duration)).toBeGreaterThanOrEqual(6.9);
    expect(Number(probe.format.duration)).toBeLessThan(7.2);
  }, 60_000);

  it('falls back to a title card when no photos are captured', async () => {
    const noPhotoListing: PropertyListingSummary = {
      ...listing,
      id: 'e2e-listing-2',
      photoUrls: [],
    };
    const noPhotoStore = {
      get: async (id: string) =>
        id === noPhotoListing.id ? noPhotoListing : null,
    };
    const service = new ListingVideoService(noPhotoStore as any, outDir);
    const result = await service.generateVideo(noPhotoListing.id, {
      narration: false,
    });
    expect(result).not.toBeNull();
    expect(result!.photosUsed).toBe(0);
    expect(fs.existsSync(result!.path)).toBe(true);
  }, 30_000);

  it('honors photoOrder to curate/reorder which photos are used, ignoring out-of-range indexes', async () => {
    const service = new ListingVideoService(store as any, outDir);
    // listing.photoUrls has 2 entries (indexes 0,1); ask for [1, 5] — 5 is
    // out of range and must be dropped rather than crashing the render.
    const result = await service.generateVideo(listing.id, {
      maxPhotos: 2,
      secondsPerPhoto: 2,
      narration: false,
      photoOrder: [1, 5],
    });
    expect(result).not.toBeNull();
    expect(result!.photosUsed).toBe(1);
    expect(fs.existsSync(result!.path)).toBe(true);
  }, 30_000);

  it('accepts a custom ctaText and narrationScript without breaking the render', async () => {
    const service = new ListingVideoService(store as any, outDir);
    const result = await service.generateVideo(listing.id, {
      maxPhotos: 2,
      secondsPerPhoto: 2,
      narration: process.platform === 'win32',
      ctaText: 'Open house Saturday 1-3pm',
      narrationScript: 'Custom voiceover for this walkthrough.',
    });
    expect(result).not.toBeNull();
    expect(result!.photosUsed).toBe(2);
    expect(fs.existsSync(result!.path)).toBe(true);
    expect(fs.statSync(result!.path).size).toBeGreaterThan(1000);
  }, 60_000);

  it('skips an unreadable photo instead of failing the entire reel', async () => {
    const corruptPhoto = path.join(workDir, 'not-an-image.jpg');
    fs.writeFileSync(corruptPhoto, 'not actually a jpeg');
    const badPhotoListing: PropertyListingSummary = {
      ...listing,
      id: 'e2e-listing-3',
      photoUrls: [corruptPhoto],
    };
    const badPhotoStore = {
      get: async (id: string) =>
        id === badPhotoListing.id ? badPhotoListing : null,
    };
    const service = new ListingVideoService(badPhotoStore as any, outDir);
    const result = await service.generateVideo(badPhotoListing.id, {
      narration: false,
    });

    expect(result).not.toBeNull();
    expect(result!.photosUsed).toBe(0);
    expect(result!.durationSeconds).toBe(7);
    expect(fs.existsSync(result!.path)).toBe(true);
  }, 30_000);
});
