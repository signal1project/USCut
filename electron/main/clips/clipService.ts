import ffmpeg from 'fluent-ffmpeg';
import { resolveFfmpegPath } from '../../util/ffmpegBinary';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import type { AIProvider } from '@mas/types';
import {
  parseSrtOrVtt,
  toSrt,
  transcribeViaOpenAI,
  transcribeViaLocalWhisper,
  type TranscriptSegment,
} from './transcription';
import { pickHighlights, type HighlightWindow } from './autoClip';

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
}

export interface AutoClipResult {
  transcriptSource: 'provided' | 'whisper' | 'whisper-local';
  pickedBy: 'ai' | 'heuristic';
  clips: Array<{
    path: string;
    start: number;
    end: number;
    durationSeconds: number;
    hook: string;
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
  srtPath: string | null,
  vertical: boolean,
): Promise<void> {
  const vf: string[] = [];
  if (vertical) {
    vf.push(
      'scale=-2:1920',
      "crop='min(iw,1080)':1920:(iw-min(iw\\,1080))/2:0",
      'pad=1080:1920:(ow-iw)/2:(oh-ih)/2',
    );
  }
  if (srtPath) {
    vf.push(`subtitles='${srtPath.replace(/\\/g, '/').replace(/:/g, '\\:')}'`);
  }
  return new Promise((resolve, reject) => {
    ffmpeg(src)
      .seekInput(win.start)
      .duration(win.end - win.start)
      .videoFilters(vf.length ? vf.join(',') : 'null')
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions(['-preset fast', '-crf 20', '-movflags +faststart'])
      .output(outPath)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
}

/**
 * Opus-Clip-style repurposing: long video in, short vertical highlight clips
 * out. Transcript comes from the caller (SRT/VTT) or Whisper; the AI provider
 * picks the moments (heuristic scoring when no provider is configured);
 * FFmpeg cuts, crops to 9:16, and burns window-relative captions.
 */
export class ClipService {
  constructor(private readonly deps: ClipServiceDeps) {}

  async autoClip(input: AutoClipInput): Promise<AutoClipResult> {
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
        segments = await transcribeViaOpenAI(input.videoPath, key);
        transcriptSource = 'whisper';
      } else {
        // No key configured — fall back to local whisper.cpp (no upload, no
        // cost). Its own error message already explains the toolchain
        // prerequisite and the alternatives, so surface it as-is.
        segments = await transcribeViaLocalWhisper(input.videoPath);
        transcriptSource = 'whisper-local';
      }
    }
    if (segments.length === 0) throw new Error('transcript_empty');

    // 2. Pick highlights
    const opts = {
      maxClips: Math.min(Math.max(input.maxClips ?? 3, 1), 8),
      clipSeconds: Math.min(Math.max(input.clipSeconds ?? 30, 10), 90),
    };
    const { windows, pickedBy } = await pickHighlights(
      segments,
      opts,
      this.deps.resolveProvider(),
    );
    if (windows.length === 0) throw new Error('no_highlights_found');

    // 3. Cut
    fs.mkdirSync(this.deps.outputDir, { recursive: true });
    const work = path.join(os.tmpdir(), `aicut-clips-${crypto.randomUUID()}`);
    fs.mkdirSync(work, { recursive: true });
    const burn = input.burnCaptions ?? true;
    const vertical = input.vertical ?? true;

    const clips: AutoClipResult['clips'] = [];
    try {
      for (const [i, win] of windows.entries()) {
        let srtPath: string | null = null;
        if (burn) {
          const winSegs = segments.filter(
            (s) => s.end > win.start && s.start < win.end,
          );
          if (winSegs.length) {
            srtPath = path.join(work, `clip_${i}.srt`);
            fs.writeFileSync(srtPath, toSrt(winSegs, win.start), 'utf8');
          }
        }
        const outPath = path.join(
          this.deps.outputDir,
          `clip-${Date.now()}-${i + 1}.mp4`,
        );
        await cutClip(input.videoPath, win, outPath, srtPath, vertical);
        clips.push({
          path: outPath,
          start: win.start,
          end: win.end,
          durationSeconds: Math.round((win.end - win.start) * 10) / 10,
          hook: win.hook,
        });
      }
    } finally {
      fs.rm(work, { recursive: true, force: true }, () => {});
    }

    return { transcriptSource, pickedBy, clips };
  }
}
