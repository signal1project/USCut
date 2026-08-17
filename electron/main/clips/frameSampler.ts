import ffmpeg from 'fluent-ffmpeg';
import { resolveFfmpegPath } from '../../util/ffmpegBinary';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import type { AnalyzeFramesInput } from '@mas/types';

export interface SampleFramesOptions {
  /** Seconds into the source video to start sampling (default 0). */
  startSeconds?: number;
  /** Seconds into the source video to stop sampling (default: end of file). */
  endSeconds?: number;
  /** Seconds between samples. */
  intervalSeconds: number;
  /** Hard cap on frames extracted, to bound cost/latency on long videos. */
  maxFrames?: number;
}

/**
 * Extracts JPEG frames from a video at a fixed interval, in one ffmpeg pass
 * (the `fps` filter, not N separate seeks — much cheaper for dozens of
 * samples). Used to feed AIProvider.analyzeFrames() for subject tracking and
 * genre-agnostic highlight detection.
 */
export async function sampleFrames(
  videoPath: string,
  opts: SampleFramesOptions,
): Promise<AnalyzeFramesInput[]> {
  const start = opts.startSeconds ?? 0;
  const duration =
    opts.endSeconds !== undefined ? Math.max(0, opts.endSeconds - start) : undefined;
  const fps = 1 / opts.intervalSeconds;

  const work = path.join(os.tmpdir(), `aicut-frames-${crypto.randomUUID()}`);
  fs.mkdirSync(work, { recursive: true });

  try {
    await new Promise<void>((resolve, reject) => {
      let cmd = ffmpeg(videoPath)
        .setFfmpegPath(resolveFfmpegPath())
        .seekInput(start);
      if (duration !== undefined) cmd = cmd.duration(duration);
      cmd
        .videoFilters(`fps=${fps}`)
        .outputOptions(['-qscale:v 4'])
        .output(path.join(work, 'frame_%04d.jpg'))
        .on('end', () => resolve())
        .on('error', reject)
        .run();
    });

    const files = fs
      .readdirSync(work)
      .filter((f) => f.endsWith('.jpg'))
      .sort();
    const capped = opts.maxFrames ? files.slice(0, opts.maxFrames) : files;

    return capped.map((f, i) => ({
      timestampSeconds: start + i * opts.intervalSeconds,
      base64Jpeg: fs.readFileSync(path.join(work, f)).toString('base64'),
    }));
  } finally {
    fs.rm(work, { recursive: true, force: true }, () => {});
  }
}
