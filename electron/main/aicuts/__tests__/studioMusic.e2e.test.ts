import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveFfmpegPath } from '../../../util/ffmpegBinary';
import {
  listStudioMusic,
  prepareMusicBed,
  MAX_MUSIC_BED_SECONDS,
} from '../studioMusic';

const run = promisify(execFile);

describe('Studio music bed — real ffmpeg', () => {
  let workDir: string;
  let shortTrack: string;

  beforeAll(async () => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-music-'));
    const ffmpeg = resolveFfmpegPath();
    shortTrack = path.join(workDir, 'loop.m4a');
    // 3-second tone — deliberately shorter than the beds we ask for.
    await run(ffmpeg, [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=220:duration=3',
      '-c:a',
      'aac',
      shortTrack,
    ]);
  }, 60000);

  afterAll(() => fs.rmSync(workDir, { recursive: true, force: true }));

  it('loops a short track up to the requested length with a tail fade', async () => {
    const bed = await prepareMusicBed(shortTrack, 8, workDir);
    expect(fs.existsSync(bed.path)).toBe(true);
    // probeVideo (real ffprobe) drives bed.duration.
    expect(bed.duration).toBeGreaterThan(7.5);
    expect(bed.duration).toBeLessThan(8.6);
  });

  it('keeps looping past the source length and honours the render cap', async () => {
    const bed = await prepareMusicBed(shortTrack, 15, workDir); // 5x the 3s source
    expect(bed.duration).toBeGreaterThan(14);
    expect(bed.duration).toBeLessThanOrEqual(MAX_MUSIC_BED_SECONDS);
  }, 30000);

  it('rejects a missing or relative music path', async () => {
    await expect(
      prepareMusicBed(path.join(workDir, 'nope.mp3'), 5, workDir),
    ).rejects.toThrow();
    await expect(prepareMusicBed('relative.mp3', 5, workDir)).rejects.toThrow(
      'absolute path',
    );
  });

  it('lists audio in a music directory root and one level of subfolders', () => {
    const root = path.join(workDir, 'library');
    fs.mkdirSync(path.join(root, 'luxury'), { recursive: true });
    fs.writeFileSync(path.join(root, 'a-top.mp3'), '');
    fs.writeFileSync(path.join(root, 'notes.txt'), '');
    fs.writeFileSync(path.join(root, 'luxury', 'b-deep.wav'), '');
    const names = listStudioMusic(root).map((m) => m.name);
    expect(names).toContain('a-top.mp3');
    expect(names).toContain('luxury/b-deep.wav');
    expect(names).not.toContain('notes.txt');
    expect(listStudioMusic(null)).toEqual([]);
  });
});
