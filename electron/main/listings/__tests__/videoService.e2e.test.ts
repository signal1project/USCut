import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ListingVideoService } from '../videoService';
import { resolveFfmpegPath } from '../../../util/ffmpegBinary';
import { Settings, type SettingsStore } from '../../settings/settings';
import type { BrandProfile } from '../../settings/settings';
import type { PropertyListingSummary } from '../types';

function mapStore(): SettingsStore {
  const m = new Map<string, unknown>();
  return { get: (k) => m.get(k), set: (k, v) => void m.set(k, v) };
}

async function probeStreams(filePath: string, select: string) {
  const ffprobePath = resolveFfmpegPath().replace(
    /ffmpeg(\.exe)?$/,
    'ffprobe$1',
  );
  const probeBin = fs.existsSync(ffprobePath) ? ffprobePath : 'ffprobe';
  const { stdout } = await run(probeBin, [
    '-v',
    'error',
    '-select_streams',
    select,
    '-show_entries',
    'stream=codec_type,width,height,codec_name',
    '-show_entries',
    'format=duration',
    '-of',
    'json',
    filePath,
  ]);
  return JSON.parse(stdout);
}

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
    photoCaptions: [],
    agentName: 'Jane Agent',
    agentPhone: '555-1234',
    agentEmail: null,
    listingUrl: 'https://www.zillow.com/homedetails/123-test',
    complianceOk: true,
    complianceFlags: [],
    capturedAt: new Date().toISOString(),
    filesFolder: null,
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

  it('renders the gallery template (more photos, faster pace, progress bar) without error', async () => {
    const service = new ListingVideoService(store as any, outDir);
    const result = await service.generateVideo(listing.id, {
      reelTemplate: 'gallery',
      narration: false,
    });
    expect(result).not.toBeNull();
    expect(result!.photosUsed).toBe(2); // fixture only has 2 photos
    expect(fs.existsSync(result!.path)).toBe(true);
    const probe = await probeStreams(result!.path, 'v:0');
    expect(probe.streams[0].width).toBe(1080);
    expect(probe.streams[0].height).toBe(1920);
  }, 60_000);

  it('renders the viral template (fast pace, cycling stroked text) noticeably shorter than the default pace', async () => {
    const service = new ListingVideoService(store as any, outDir);
    const result = await service.generateVideo(listing.id, {
      reelTemplate: 'viral',
      narration: false,
    });
    expect(result).not.toBeNull();
    expect(result!.photosUsed).toBe(2);
    expect(fs.existsSync(result!.path)).toBe(true);
    // viral defaults to ~1s/photo vs. just-listed's 3s — well under the
    // ~7s a just-listed render of this same 2-photo fixture produces.
    expect(result!.durationSeconds).toBeLessThan(6);
  }, 60_000);

  it('prepends a branded intro card when includeBranding is set and a brand kit is configured', async () => {
    const settings = new Settings(mapStore());
    settings.setBrandProfiles([
      {
        id: 'b1',
        name: 'Dale Brown Real Estate',
        bio: '',
        voice: '',
        audience: '',
        hashtags: [],
        bannedWords: [],
        signature: 'Your Kirkwood Expert',
      } satisfies BrandProfile,
    ]);
    const service = new ListingVideoService(
      store as any,
      outDir,
      null,
      null,
      null,
      settings,
    );
    const result = await service.generateVideo(listing.id, {
      maxPhotos: 2,
      secondsPerPhoto: 2,
      narration: false,
      includeBranding: true,
    });
    expect(result).not.toBeNull();
    expect(fs.existsSync(result!.path)).toBe(true);
    // 2 photos * 2s + 3s CTA + 3s brand intro = 10s, vs. 7s without branding.
    const probe = await probeStreams(result!.path, 'v:0');
    expect(Number(probe.format.duration)).toBeGreaterThan(9);
  }, 60_000);

  it('skips branding silently when includeBranding is set but no brand kit is configured', async () => {
    const settings = new Settings(mapStore());
    const service = new ListingVideoService(
      store as any,
      outDir,
      null,
      null,
      null,
      settings,
    );
    const result = await service.generateVideo(listing.id, {
      maxPhotos: 2,
      secondsPerPhoto: 2,
      narration: false,
      includeBranding: true,
    });
    expect(result).not.toBeNull();
    expect(fs.existsSync(result!.path)).toBe(true);
  }, 60_000);

  it('uses a music folder selected after the service starts without restarting', async () => {
    const musicDir = path.join(workDir, 'music');
    fs.mkdirSync(path.join(musicDir, 'standard'), { recursive: true });
    const track = path.join(musicDir, 'standard', 'track.wav');
    await run(resolveFfmpegPath(), [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=10',
      track,
    ]);

    const settings = new Settings(mapStore());
    const service = new ListingVideoService(
      store as any,
      outDir,
      null,
      null,
      path.join(workDir, 'empty-bundled-music'),
      settings,
    );
    settings.setMusicDir(musicDir);
    const result = await service.generateVideo(listing.id, {
      maxPhotos: 2,
      secondsPerPhoto: 2,
      narration: false,
      reelTemplate: 'just-listed',
    });
    expect(result).not.toBeNull();
    expect(fs.existsSync(result!.path)).toBe(true);
    const probe = await probeStreams(result!.path, 'a:0');
    expect(
      probe.streams.some(
        (s: { codec_type: string }) => s.codec_type === 'audio',
      ),
    ).toBe(true);
  }, 60_000);
});
