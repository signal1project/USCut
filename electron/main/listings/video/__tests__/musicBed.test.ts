import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { selectMusicTrack } from '../musicBed';

function makeMusicDir(files: Record<string, string[]>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-test-'));
  for (const [tier, names] of Object.entries(files)) {
    const tierDir = path.join(dir, tier);
    fs.mkdirSync(tierDir, { recursive: true });
    for (const name of names) fs.writeFileSync(path.join(tierDir, name), 'fake');
  }
  return dir;
}

describe('selectMusicTrack', () => {
  it('picks the first audio file alphabetically, ignoring non-audio files', () => {
    const dir = makeMusicDir({
      standard: ['README.md', 'zzz-track.mp3', 'aaa-track.mp3'],
    });
    expect(selectMusicTrack('standard', dir)).toBe(
      path.join(dir, 'standard', 'aaa-track.mp3'),
    );
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns null when the tier folder only has non-audio files (e.g. just the README placeholder)', () => {
    const dir = makeMusicDir({ luxury: ['README.md'] });
    expect(selectMusicTrack('luxury', dir)).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns null when the tier folder does not exist', () => {
    const dir = makeMusicDir({ standard: ['a.mp3'] });
    expect(selectMusicTrack('luxury', dir)).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns null when musicDir itself is null/undefined', () => {
    expect(selectMusicTrack('standard', null)).toBeNull();
    expect(selectMusicTrack('standard', undefined)).toBeNull();
  });

  it('recognizes wav/m4a/ogg in addition to mp3', () => {
    const dir = makeMusicDir({ standard: ['track.wav'] });
    expect(selectMusicTrack('standard', dir)).toBe(
      path.join(dir, 'standard', 'track.wav'),
    );
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
