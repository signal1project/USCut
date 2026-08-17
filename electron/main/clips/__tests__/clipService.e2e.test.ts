import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AIProvider, AnalyzeFramesInput } from '@mas/types';
import { ClipService } from '../clipService';
import { toAss } from '../transcription';
import { resolveFfmpegPath } from '../../../util/ffmpegBinary';

const run = promisify(execFile);

/**
 * Real end-to-end smoke test: generates a synthetic 6s video with ffmpeg,
 * runs it through the actual ClipService (no ffmpeg mocking) with a fake AI
 * provider that supplies both a highlight window and subject-tracking
 * points, and verifies via ffprobe that a valid 1080x1920 mp4 comes out —
 * i.e. that the hand-built tracked-crop ffmpeg filter expression
 * (trackedCrop.ts) is actually valid ffmpeg syntax, not just plausible-
 * looking strings. Also covers the plain (non-tracked) path for contrast.
 */
describe('ClipService — real ffmpeg E2E', () => {
  let videoPath: string;
  let outDir: string;

  const SRT = `1
00:00:00,000 --> 00:00:03,000
Here is the first thing worth clipping.

2
00:00:03,000 --> 00:00:06,000
And here is the second moment.
`;

  const trackingProvider = {
    name: 'mock',
    generateText: async () => '',
    async analyzeFrames(_frames: AnalyzeFramesInput[], prompt: string) {
      if (prompt.includes('locate the primary subject')) {
        return JSON.stringify({
          points: [
            { t: 0, cx: 0.2, cy: 0.5 },
            { t: 1, cx: 0.5, cy: 0.5 },
            { t: 2, cx: 0.8, cy: 0.5 },
          ],
        });
      }
      // Curation call (genre-agnostic visual pass) — one full-window highlight.
      return JSON.stringify([
        { start: 0, end: 6, hook: 'the full clip', score: 88 },
      ]);
    },
  } as unknown as AIProvider;

  beforeAll(async () => {
    const workDir = path.join(os.tmpdir(), `uscut-clip-e2e-${crypto.randomUUID()}`);
    outDir = path.join(os.tmpdir(), `uscut-clip-e2e-out-${crypto.randomUUID()}`);
    fs.mkdirSync(workDir, { recursive: true });
    videoPath = path.join(workDir, 'source.mp4');

    const ffmpegPath = resolveFfmpegPath();
    await run(ffmpegPath, [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=960x540:duration=6:rate=15',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=r=44100:cl=stereo',
      '-shortest',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      videoPath,
    ]);
  }, 30_000);

  afterAll(() => {
    fs.rmSync(path.dirname(videoPath), { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  async function probeDims(file: string): Promise<{ width: number; height: number }> {
    const ffprobePath = resolveFfmpegPath().replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');
    const probeBin = fs.existsSync(ffprobePath) ? ffprobePath : 'ffprobe';
    const { stdout } = await run(probeBin, [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height',
      '-of',
      'json',
      file,
    ]);
    const probe = JSON.parse(stdout);
    return { width: probe.streams[0].width, height: probe.streams[0].height };
  }

  it('produces a valid 1080x1920 mp4 using the tracked-crop filter', async () => {
    const service = new ClipService({
      outputDir: outDir,
      resolveOpenAiKey: () => null,
      resolveProvider: () => trackingProvider,
    });
    const result = await service.autoClip({
      videoPath,
      transcriptSrt: SRT,
      maxClips: 1,
      clipSeconds: 6,
      trackSubject: true,
    });

    expect(result.pickedBy).toBe('ai-visual');
    expect(result.clips).toHaveLength(1);
    const clip = result.clips[0];
    expect(clip.tracked).toBe(true);
    expect(fs.existsSync(clip.path)).toBe(true);
    expect(fs.statSync(clip.path).size).toBeGreaterThan(1000);

    const dims = await probeDims(clip.path);
    expect(dims.width).toBe(1080);
    expect(dims.height).toBe(1920);
  }, 60_000);

  it('falls back to the fixed center-crop when trackSubject is false', async () => {
    const service = new ClipService({
      outputDir: outDir,
      resolveOpenAiKey: () => null,
      resolveProvider: () => trackingProvider,
    });
    const result = await service.autoClip({
      videoPath,
      transcriptSrt: SRT,
      maxClips: 1,
      clipSeconds: 6,
      trackSubject: false,
    });

    expect(result.clips[0].tracked).toBe(false);
    const dims = await probeDims(result.clips[0].path);
    expect(dims.width).toBe(1080);
    expect(dims.height).toBe(1920);
  }, 60_000);
});

/**
 * Validates the other hand-built format this phase introduced: toAss()'s
 * karaoke `\k` syntax against real libass (ffmpeg's bundled subtitle
 * renderer), not just plausible-looking strings. Burns directly via ffmpeg
 * rather than going through ClipService, to isolate the ASS-specific risk
 * from the tracked-crop risk already covered above.
 */
describe('toAss() karaoke captions — real libass E2E', () => {
  let workDir: string;

  beforeAll(() => {
    workDir = path.join(os.tmpdir(), `uscut-ass-e2e-${crypto.randomUUID()}`);
    fs.mkdirSync(workDir, { recursive: true });
  }, 10_000);

  afterAll(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('burns a word-level karaoke ASS file without ffmpeg erroring', async () => {
    const ass = toAss([
      {
        start: 0,
        end: 2,
        text: 'Hello there world',
        words: [
          { start: 0, end: 0.5, text: 'Hello' },
          { start: 0.5, end: 1, text: 'there' },
          { start: 1, end: 2, text: 'world' },
        ],
      },
    ]);
    const assPath = path.join(workDir, 'captions.ass');
    fs.writeFileSync(assPath, ass, 'utf8');
    const outPath = path.join(workDir, 'out.mp4');

    const ffmpegPath = resolveFfmpegPath();
    await run(ffmpegPath, [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=1080x1920:d=2:r=15',
      '-vf',
      `subtitles='${assPath.replace(/\\/g, '/').replace(/:/g, '\\:')}'`,
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      outPath,
    ]);

    expect(fs.existsSync(outPath)).toBe(true);
    expect(fs.statSync(outPath).size).toBeGreaterThan(1000);
  }, 30_000);
});
