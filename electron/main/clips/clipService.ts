import ffmpeg from 'fluent-ffmpeg';
import { resolveFfmpegPath } from '../../util/ffmpegBinary';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import type { AIProvider, JobExecution } from '@mas/types';
import {
  parseSrtOrVtt,
  toAss,
  transcribeViaOpenAI,
  transcribeViaLocalWhisper,
  type TranscriptSegment,
} from './transcription';
import { pickHighlights, type HighlightWindow } from './autoClip';
import { trackSubject, type TrackPoint } from './subjectTracker';
import { buildTrackedCropFilter } from './trackedCrop';
import { sampleFrames } from './frameSampler';

ffmpeg.setFfmpegPath(resolveFfmpegPath());

export interface AutoClipInput {
  videoPath: string;
  /** SRT/VTT transcript. When omitted, Whisper (OpenAI key) is required. */
  transcriptSrt?: string;
  maxClips?: number;
  clipSeconds?: number;
  /** Crop to 9:16 vertical (default true) and burn captions (default true). */
  vertical?: boolean;
  burnCaptions?: boolean;
  /**
   * Natural-language filter, e.g. "find the funny moments" — see
   * PickOptions.query in autoClip.ts for how the AI vs heuristic paths
   * differ in how strictly this is honored.
   */
  query?: string;
  /**
   * Follow the on-screen subject with a moving crop instead of a fixed
   * center-crop (default: on when a vision-capable AI provider is
   * configured; silently has no effect otherwise — see subjectTracker.ts).
   */
  trackSubject?: boolean;
}

export interface AutoClipResult {
  transcriptSource: 'provided' | 'whisper' | 'whisper-local';
  pickedBy: 'ai' | 'ai-visual' | 'heuristic';
  clips: Array<{
    path: string;
    start: number;
    end: number;
    durationSeconds: number;
    hook: string;
    score: number;
    /** True when a moving subject-tracking crop was actually used for this clip. */
    tracked: boolean;
  }>;
}

export interface ClipServiceDeps {
  outputDir: string;
  /** OpenAI key for Whisper, when configured. */
  resolveOpenAiKey: () => string | null;
  /** Active AI provider for highlight picking (null → heuristic). */
  resolveProvider: () => AIProvider | null;
}

function cutClip(
  src: string,
  win: HighlightWindow,
  outPath: string,
  captionsPath: string | null,
  vertical: boolean,
  track: TrackPoint[] | null,
  signal?: AbortSignal,
): Promise<void> {
  const vf: string[] = [];
  if (vertical) {
    vf.push(
      'scale=-2:1920',
      track
        ? buildTrackedCropFilter(track)
        : "crop='min(iw,1080)':1920:(iw-min(iw\\,1080))/2:0",
      'pad=1080:1920:(ow-iw)/2:(oh-ih)/2',
    );
  }
  if (captionsPath) {
    // ffmpeg's subtitles filter picks SRT vs ASS rendering by extension —
    // .ass gets styled/karaoke rendering via libass (see transcription.ts toAss()).
    vf.push(
      `subtitles='${captionsPath.replace(/\\/g, '/').replace(/:/g, '\\:')}'`,
    );
  }
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const command = ffmpeg(src)
      .seekInput(win.start)
      .duration(win.end - win.start)
      .videoFilters(vf.length ? vf.join(',') : 'null')
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions(['-preset fast', '-crf 20', '-movflags +faststart'])
      .output(outPath)
      .on('start', () => {
        if (signal?.aborted) command.kill('SIGKILL');
      })
      .on('end', () => {
        signal?.removeEventListener('abort', abort);
        resolve();
      })
      .on('error', (err) => {
        signal?.removeEventListener('abort', abort);
        reject(err);
      });
    const abort = () => {
      command.kill('SIGKILL');
    };
    signal?.addEventListener('abort', abort, { once: true });
    command.run();
  });
}

/**
 * Opus-Clip-style repurposing: long video in, short vertical highlight clips
 * out, ranked by score. Transcript comes from the caller (SRT/VTT) or
 * Whisper; the AI provider picks the moments — optionally filtered by a
 * natural-language `query` — with heuristic scoring/filtering when no
 * provider is configured; FFmpeg cuts, crops to 9:16, and burns
 * window-relative captions.
 */
export class ClipService {
  constructor(private readonly deps: ClipServiceDeps) {}

  async autoClip(
    input: AutoClipInput,
    context?: JobExecution,
  ): Promise<AutoClipResult> {
    const report = (stage: string, progress: number) => {
      context?.signal.throwIfAborted();
      context?.report(stage, progress);
    };
    report('Preparing transcript', 1);
    if (!fs.existsSync(input.videoPath)) throw new Error('video_not_found');

    // 1. Transcript
    let segments: TranscriptSegment[];
    let transcriptSource: AutoClipResult['transcriptSource'];
    if (input.transcriptSrt?.trim()) {
      segments = parseSrtOrVtt(input.transcriptSrt);
      transcriptSource = 'provided';
    } else {
      const key = this.deps.resolveOpenAiKey();
      if (key) {
        segments = await transcribeViaOpenAI(input.videoPath, key, {
          signal: context?.signal,
          onProgress: (completed, total) =>
            report(
              `Transcribing audio ${completed}/${total}`,
              5 + (completed / total) * 30,
            ),
        });
        transcriptSource = 'whisper';
      } else {
        // No key configured — fall back to local whisper.cpp (no upload, no
        // cost). Uses the bundled engine; no first-use compilation.
        report('Transcribing locally', 5);
        segments = await transcribeViaLocalWhisper(
          input.videoPath,
          'base.en',
          context?.signal,
        );
        transcriptSource = 'whisper-local';
      }
    }
    report('Finding highlights', 38);
    if (segments.length === 0) throw new Error('transcript_empty');

    // 2. Pick highlights — sample frames across the whole video first (when
    // a vision-capable provider is configured) so genre-agnostic/visually-
    // driven moments can surface, not just transcript-scored ones.
    const opts = {
      maxClips: Math.min(Math.max(input.maxClips ?? 3, 1), 8),
      clipSeconds: Math.min(Math.max(input.clipSeconds ?? 30, 10), 90),
      query: input.query?.trim() || undefined,
    };
    const provider = this.deps.resolveProvider();
    let curationFrames: Awaited<ReturnType<typeof sampleFrames>> | undefined;
    if (provider?.analyzeFrames) {
      try {
        const totalDuration = segments[segments.length - 1].end;
        const maxFrames = 40;
        const interval = Math.max(2, totalDuration / maxFrames);
        curationFrames = await sampleFrames(input.videoPath, {
          intervalSeconds: interval,
          maxFrames,
        });
      } catch {
        // Sampling failure degrades to transcript-only curation, not a hard error.
        curationFrames = undefined;
      }
    }
    report('Ranking highlights', 45);
    const { windows, pickedBy } = await pickHighlights(
      segments,
      opts,
      provider,
      curationFrames,
    );
    report('Preparing clips', 55);
    if (windows.length === 0) throw new Error('no_highlights_found');

    // 3. Cut
    fs.mkdirSync(this.deps.outputDir, { recursive: true });
    const work = path.join(os.tmpdir(), `aicut-clips-${crypto.randomUUID()}`);
    fs.mkdirSync(work, { recursive: true });
    const burn = input.burnCaptions ?? true;
    const vertical = input.vertical ?? true;
    const wantTracking =
      (input.trackSubject ?? true) && !!provider?.analyzeFrames;

    const clips: AutoClipResult['clips'] = [];
    const createdPaths: string[] = [];
    try {
      for (const [i, win] of windows.entries()) {
        report(
          `Preparing clip ${i + 1}/${windows.length}`,
          55 + (i / windows.length) * 40,
        );
        let captionsPath: string | null = null;
        if (burn) {
          const winSegs = segments.filter(
            (s) => s.end > win.start && s.start < win.end,
          );
          if (winSegs.length) {
            captionsPath = path.join(work, `clip_${i}.ass`);
            fs.writeFileSync(captionsPath, toAss(winSegs, win.start), 'utf8');
          }
        }
        const track =
          vertical && wantTracking
            ? await trackSubject(input.videoPath, win, provider)
            : null;
        const outPath = path.join(
          this.deps.outputDir,
          `clip-${crypto.randomUUID()}-${i + 1}.mp4`,
        );
        report(
          `Rendering clip ${i + 1}/${windows.length}`,
          57 + (i / windows.length) * 40,
        );
        createdPaths.push(outPath);
        await cutClip(
          input.videoPath,
          win,
          outPath,
          captionsPath,
          vertical,
          track,
          context?.signal,
        );
        context?.signal.throwIfAborted();
        clips.push({
          path: outPath,
          start: win.start,
          end: win.end,
          tracked: track !== null,
          durationSeconds: Math.round((win.end - win.start) * 10) / 10,
          hook: win.hook,
          score: win.score,
        });
      }
      report('Finishing clips', 99);
    } catch (err) {
      await Promise.all(
        createdPaths.map((file) => fs.promises.rm(file, { force: true })),
      );
      throw err;
    } finally {
      fs.rm(work, { recursive: true, force: true }, () => {});
    }

    // Windows are cut in chronological order (required for the heuristic
    // picker's overlap check); the returned list is ranked highest-score
    // first, like Opus Clip's output, since that's the order a caller (UI or
    // agent) actually wants to consume clips in.
    clips.sort((a, b) => b.score - a.score);

    return { transcriptSource, pickedBy, clips };
  }
}
