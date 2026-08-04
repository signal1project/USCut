import { describe, it, expect } from 'vitest';
import path from 'path';
import os from 'os';
import { decidePreviewStrategy, proxyCachePath } from '../previewProxy';
import type { ProbeResult } from '../ffmpegOps';

function probe(overrides: Partial<ProbeResult>): ProbeResult {
  return { duration: 10, hasAudio: true, ...overrides };
}

describe('decidePreviewStrategy', () => {
  it('plays h264/aac mp4 directly', () => {
    expect(
      decidePreviewStrategy(
        probe({ width: 1920, videoCodec: 'h264', audioCodec: 'aac' }),
        'C:\\v\\a.mp4',
      ),
    ).toBe('direct');
  });

  it('remuxes h264/aac in a .mov container (no re-encode)', () => {
    expect(
      decidePreviewStrategy(
        probe({ width: 1920, videoCodec: 'h264', audioCodec: 'aac' }),
        'C:\\v\\a.mov',
      ),
    ).toBe('remux');
  });

  it('transcodes HEVC phone video', () => {
    expect(
      decidePreviewStrategy(
        probe({ width: 3840, videoCodec: 'hevc', audioCodec: 'aac' }),
        'C:\\v\\IMG_1234.MOV',
      ),
    ).toBe('transcode');
  });

  it('transcodes hevc even in an mp4 container', () => {
    expect(
      decidePreviewStrategy(
        probe({ width: 1920, videoCodec: 'hevc', audioCodec: 'aac' }),
        'C:\\v\\a.mp4',
      ),
    ).toBe('transcode');
  });

  it('transcodes when audio codec is unplayable even if video is fine', () => {
    expect(
      decidePreviewStrategy(
        probe({ width: 1920, videoCodec: 'h264', audioCodec: 'ac3' }),
        'C:\\v\\a.mp4',
      ),
    ).toBe('transcode');
  });

  it('handles video with no audio stream', () => {
    expect(
      decidePreviewStrategy(
        probe({ width: 1280, videoCodec: 'h264', hasAudio: false }),
        'C:\\v\\a.mp4',
      ),
    ).toBe('direct');
  });

  it('plays common audio files directly', () => {
    expect(
      decidePreviewStrategy(probe({ audioCodec: 'mp3' }), 'C:\\a\\song.mp3'),
    ).toBe('direct');
    expect(
      decidePreviewStrategy(
        probe({ audioCodec: 'pcm_s16le' }),
        'C:\\a\\take.wav',
      ),
    ).toBe('direct');
  });

  it('transcodes exotic audio containers', () => {
    expect(
      decidePreviewStrategy(probe({ audioCodec: 'wmav2' }), 'C:\\a\\old.wma'),
    ).toBe('transcode');
  });

  it('remuxes vp9 in mkv', () => {
    expect(
      decidePreviewStrategy(
        probe({ width: 1920, videoCodec: 'vp9', audioCodec: 'opus' }),
        'C:\\v\\a.mkv',
      ),
    ).toBe('remux');
  });
});

describe('proxyCachePath', () => {
  const dir = path.join(os.tmpdir(), 'proxy-cache');

  it('is stable for identical source + stat', () => {
    const a = proxyCachePath('C:\\v\\a.mov', { size: 100, mtimeMs: 5000 }, dir);
    const b = proxyCachePath('C:\\v\\a.mov', { size: 100, mtimeMs: 5000 }, dir);
    expect(a).toBe(b);
    expect(a.startsWith(dir)).toBe(true);
    expect(a.endsWith('.mp4')).toBe(true);
  });

  it('changes when the file is modified', () => {
    const a = proxyCachePath('C:\\v\\a.mov', { size: 100, mtimeMs: 5000 }, dir);
    const b = proxyCachePath('C:\\v\\a.mov', { size: 100, mtimeMs: 6000 }, dir);
    expect(a).not.toBe(b);
  });
});
