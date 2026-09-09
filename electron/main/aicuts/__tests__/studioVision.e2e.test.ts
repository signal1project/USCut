import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AIProvider, AnalyzeFramesInput } from '@mas/types';
import { resolveFfmpegPath } from '../../../util/ffmpegBinary';
import { describeStudioAssets } from '../studioVision';

const run = promisify(execFile);

/**
 * Real ffmpeg frame sampling + a fake vision provider: proves Studio's
 * storyboard grounding actually extracts JPEG frames from supplied media and
 * feeds them to analyzeFrames(), and that the fallbacks hold.
 */
describe('describeStudioAssets — real frame sampling', () => {
  let workDir: string;
  let videoPath: string;
  let imagePath: string;

  beforeAll(async () => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-vision-'));
    const ffmpeg = resolveFfmpegPath();
    videoPath = path.join(workDir, 'clip.mp4');
    imagePath = path.join(workDir, 'still.jpg');
    await run(ffmpeg, [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=320x240:duration=6:rate=10',
      '-pix_fmt',
      'yuv420p',
      videoPath,
    ]);
    await run(ffmpeg, [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:size=320x240',
      '-frames:v',
      '1',
      imagePath,
    ]);
  }, 60000);

  afterAll(() => fs.rmSync(workDir, { recursive: true, force: true }));

  const assets = () => [
    {
      id: 'v',
      src: videoPath,
      name: 'Clip',
      type: 'video' as const,
      duration: 6,
    },
    {
      id: 'i',
      src: imagePath,
      name: 'Still',
      type: 'image' as const,
      duration: 5,
    },
  ];

  it('returns nothing when the provider cannot see images', async () => {
    const provider = { name: 'ollama' } as unknown as AIProvider;
    expect(
      await describeStudioAssets(
        assets(),
        provider,
        AbortSignal.timeout(30000),
      ),
    ).toEqual([]);
  });

  it('samples real frames and returns one trimmed sentence per asset', async () => {
    const batches: AnalyzeFramesInput[][] = [];
    const provider = {
      name: 'claude',
      async analyzeFrames(frames: AnalyzeFramesInput[]) {
        batches.push(frames);
        return 'A test pattern fills the frame. Extra sentence ignored.';
      },
    } as unknown as AIProvider;

    const insights = await describeStudioAssets(
      assets(),
      provider,
      AbortSignal.timeout(30000),
    );
    expect(insights).toEqual([
      { assetId: 'v', description: 'A test pattern fills the frame.' },
      { assetId: 'i', description: 'A test pattern fills the frame.' },
    ]);
    expect(batches).toHaveLength(2);
    expect(batches[0].length).toBeGreaterThan(1); // several frames from the video
    expect(batches[1]).toHaveLength(1); // one frame from the still
    for (const frame of batches.flat())
      expect(Buffer.from(frame.base64Jpeg, 'base64').subarray(0, 2)).toEqual(
        Buffer.from([0xff, 0xd8]),
      );
  });

  it('skips an unreadable asset instead of failing the batch', async () => {
    const provider = {
      name: 'claude',
      async analyzeFrames() {
        return 'Visible content.';
      },
    } as unknown as AIProvider;
    const insights = await describeStudioAssets(
      [
        {
          id: 'gone',
          src: path.join(workDir, 'missing.mp4'),
          name: 'Missing',
          type: 'video',
          duration: 4,
        },
        { id: 'i', src: imagePath, name: 'Still', type: 'image', duration: 5 },
      ],
      provider,
      AbortSignal.timeout(30000),
    );
    expect(insights).toEqual([
      { assetId: 'i', description: 'Visible content.' },
    ]);
  });
});
