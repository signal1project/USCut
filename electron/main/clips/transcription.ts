import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolveLocalWhisper } from './localWhisperRuntime';
import ffmpeg from 'fluent-ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import { resolveFfmpegPath } from '../../util/ffmpegBinary';

export interface TranscriptWord {
  /** Seconds. */
  start: number;
  end: number;
  text: string;
}

export interface TranscriptSegment {
  /** Seconds. */
  start: number;
  end: number;
  text: string;
  /**
   * Word-level timing, when the transcription source provides it (OpenAI
   * Whisper with timestamp_granularities, or local whisper.cpp with word
   * output enabled). Absent for caller-provided SRT/VTT — those only carry
   * segment-level timing. Used for karaoke-style caption highlighting; see
   * toAss().
   */
  words?: TranscriptWord[];
}

function timeToSeconds(t: string): number {
  const m = t.trim().match(/(\d+):(\d{2}):(\d{2})[,.](\d{1,3})/);
  if (!m) return NaN;
  return (
    Number(m[1]) * 3600 +
    Number(m[2]) * 60 +
    Number(m[3]) +
    Number(m[4].padEnd(3, '0')) / 1000
  );
}

/** Parse SRT or WebVTT into transcript segments. Exported for tests. */
export function parseSrtOrVtt(raw: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const blocks = raw.replace(/\r/g, '').split(/\n\n+/);
  for (const block of blocks) {
    const lines = block
      .split('\n')
      .filter((l) => l.trim() !== '' && l.trim() !== 'WEBVTT');
    const timeLineIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeLineIdx === -1) continue;
    const [startRaw, endRaw] = lines[timeLineIdx].split('-->');
    const start = timeToSeconds(startRaw);
    const end = timeToSeconds(endRaw);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const text = lines
      .slice(timeLineIdx + 1)
      .join(' ')
      .trim();
    if (text) segments.push({ start, end, text });
  }
  return segments;
}

export function toSrt(
  segments: TranscriptSegment[],
  offsetSeconds = 0,
): string {
  const fmt = (s: number): string => {
    const t = Math.max(0, s - offsetSeconds);
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const sec = Math.floor(t % 60);
    const ms = Math.round((t % 1) * 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
  };
  return segments
    .map(
      (seg, i) =>
        `${i + 1}\n${fmt(seg.start)} --> ${fmt(seg.end)}\n${seg.text}\n`,
    )
    .join('\n');
}

/** Escape ASS/SSA text-field special characters: braces (override-tag delimiters) and newlines. */
function escapeAssText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\n/g, '\\N');
}

function assTimestamp(seconds: number): string {
  const t = Math.max(0, seconds);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const cs = Math.round((t % 1) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/** Builds the {\kNN}word... run for one segment's karaoke-highlighted line. */
function buildKaraokeText(seg: TranscriptSegment): string {
  const words = seg.words ?? [];
  let cursor = seg.start;
  const parts: string[] = [];
  for (const w of words) {
    const centis = Math.max(1, Math.round((w.end - cursor) * 100));
    parts.push(`{\\k${centis}}${escapeAssText(w.text)} `);
    cursor = w.end;
  }
  return parts.join('').trim();
}

/**
 * Styled ASS captions — bold, larger font, centered lower-third, outline +
 * background box (a real visual upgrade over plain burned-in SRT). When a
 * segment has word-level timing (see TranscriptSegment.words), renders
 * per-word karaoke-style progressive highlighting via ASS's native `\k`
 * tags (rendered by libass, ffmpeg's bundled subtitle renderer — no new
 * dependency); segments without word timing (e.g. a caller-provided SRT)
 * fall back to a static styled line for that segment.
 */
export function toAss(
  segments: TranscriptSegment[],
  offsetSeconds = 0,
): string {
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,76,&H0000FFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,3,0,0,2,60,60,220,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const lines = segments.map((seg) => {
    const start = assTimestamp(seg.start - offsetSeconds);
    const end = assTimestamp(seg.end - offsetSeconds);
    const text = seg.words?.length
      ? buildKaraokeText(seg)
      : escapeAssText(seg.text);
    return `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`;
  });

  return header + lines.join('\n') + '\n';
}

/**
 * Parses whisper.cpp's --output-json-full token-level output into
 * word-level timing. Best-effort and defensive: whisper.cpp's JSON schema
 * has shifted across versions, and this hasn't been verified against a live
 * compiled binary in this dev environment (whisper-cli requires a C++
 * toolchain this environment doesn't have) — any shape mismatch returns an
 * empty array rather than throwing, so local transcription still succeeds
 * with segment-only (no karaoke) captions.
 */
export function parseWhisperCppJsonWords(raw: string): TranscriptWord[] {
  try {
    const data = JSON.parse(raw) as {
      transcription?: Array<{
        tokens?: Array<{
          text?: string;
          offsets?: { from?: number; to?: number };
        }>;
      }>;
    };
    const words: TranscriptWord[] = [];
    for (const seg of data.transcription ?? []) {
      for (const tok of seg.tokens ?? []) {
        const text = tok.text?.trim();
        // whisper.cpp emits special/control tokens like "[_BEG_]" — skip
        // anything that isn't plain spoken text.
        if (!text || /^\[.*\]$/.test(text)) continue;
        const from = tok.offsets?.from;
        const to = tok.offsets?.to;
        if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
        words.push({
          start: (from as number) / 1000,
          end: (to as number) / 1000,
          text,
        });
      }
    }
    return words;
  } catch {
    return [];
  }
}

/**
 * Attaches each word to the segment it time-overlaps most, for karaoke-style
 * caption highlighting. Words that don't overlap any segment (rare — gaps
 * between segments) are dropped rather than misattributed.
 */
function attachWordsToSegments(
  segments: Array<{ start: number; end: number; text: string }>,
  words: TranscriptWord[],
): TranscriptSegment[] {
  return segments.map((seg) => {
    const segWords = words.filter(
      (w) => w.end > seg.start && w.start < seg.end,
    );
    return { ...seg, words: segWords.length ? segWords : undefined };
  });
}

/**
 * Transcribe an audio/video file with the OpenAI Whisper API (verbose_json +
 * word-level timestamp_granularities gives both segment and per-word
 * timing — the latter powers karaoke-style caption highlighting in
 * toAss()). ~25MB upload limit applies; larger files should be pre-extracted
 * to audio by the caller.
 */
async function uploadWhisperChunk(
  filePath: string,
  apiKey: string,
  signal?: AbortSignal,
  prompt?: string,
): Promise<TranscriptSegment[]> {
  if (fs.statSync(filePath).size > 24_000_000)
    throw new Error('Transcription audio chunk is too large.');
  const buf = await fs.promises.readFile(filePath);
  const form = new FormData();
  form.append('file', new Blob([buf]), path.basename(filePath));
  form.append('model', 'whisper-1');
  if (prompt) form.append('prompt', prompt);
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');
  form.append('timestamp_granularities[]', 'word');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal,
  });
  if (!res.ok) throw new Error(`whisper_failed_${res.status}`);
  const data = (await res.json()) as {
    segments?: Array<{ start: number; end: number; text: string }>;
    words?: Array<{ word: string; start: number; end: number }>;
    text?: string;
    duration?: number;
  };
  const words: TranscriptWord[] = (data.words ?? []).map((w) => ({
    start: w.start,
    end: w.end,
    text: w.word,
  }));
  if (data.segments?.length) {
    const segments = data.segments.map((s) => ({
      start: s.start,
      end: s.end,
      text: s.text.trim(),
    }));
    return words.length ? attachWordsToSegments(segments, words) : segments;
  }
  if (data.text)
    return [{ start: 0, end: data.duration ?? 60, text: data.text.trim() }];
  return [];
}

export interface CloudTranscriptionOptions {
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
  /** Bounded to ten minutes; smaller windows are useful for constrained jobs. */
  chunkSeconds?: number;
}

/** Extract bounded audio windows, upload sequentially, restore source timestamps.
 * Whisper requires uploads below 25 MB; 600s of mono 16kHz PCM is ~19.2 MB.
 * https://developers.openai.com/api/docs/guides/speech-to-text
 */
export async function transcribeViaOpenAI(
  filePath: string,
  apiKey: string,
  options: CloudTranscriptionOptions = {},
): Promise<TranscriptSegment[]> {
  const chunkSeconds = options.chunkSeconds ?? 600;
  if (
    !Number.isFinite(chunkSeconds) ||
    chunkSeconds < 1 ||
    chunkSeconds > 600
  ) {
    throw new Error(
      'Transcription chunk duration must be between 1 and 600 seconds.',
    );
  }
  options.signal?.throwIfAborted();
  ffmpeg.setFfprobePath(
    ffprobeInstaller.path.replace('app.asar', 'app.asar.unpacked'),
  );
  const duration = await new Promise<number>((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      if (!metadata.streams.some((s) => s.codec_type === 'audio'))
        return reject(new Error('No audio track was found to transcribe.'));
      const seconds = metadata.format.duration;
      if (!seconds || !Number.isFinite(seconds) || seconds <= 0)
        return reject(new Error('Unable to determine audio duration.'));
      resolve(seconds);
    });
  });
  const total = Math.ceil(duration / chunkSeconds);
  const segments: TranscriptSegment[] = [];
  let context = '';
  options.onProgress?.(0, total);
  for (let i = 0; i < total; i++) {
    options.signal?.throwIfAborted();
    const start = i * chunkSeconds;
    const length = Math.min(chunkSeconds, duration - start);
    const tmp = path.join(
      os.tmpdir(),
      `aicut-cloud-whisper-${crypto.randomUUID()}.wav`,
    );
    try {
      await new Promise<void>((resolve, reject) => {
        const command = ffmpeg(filePath)
          .setFfmpegPath(resolveFfmpegPath())
          .seekInput(start)
          .duration(length)
          .noVideo()
          .audioChannels(1)
          .audioFrequency(16000)
          .audioCodec('pcm_s16le')
          .output(tmp);
        const abort = () => {
          command.kill('SIGKILL');
        };
        const cleanup = () =>
          options.signal?.removeEventListener('abort', abort);
        command.on('start', () => {
          if (options.signal?.aborted) abort();
        });
        command.on('end', () => {
          cleanup();
          resolve();
        });
        command.on('error', (err) => {
          cleanup();
          reject(err);
        });
        options.signal?.addEventListener('abort', abort, { once: true });
        command.run();
      });
      options.signal?.throwIfAborted();
      const signal = options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(10 * 60 * 1000)])
        : AbortSignal.timeout(10 * 60 * 1000);
      const chunk = await uploadWhisperChunk(tmp, apiKey, signal, context);
      for (const segment of chunk) {
        if (!Number.isFinite(segment.start) || !Number.isFinite(segment.end))
          continue;
        const localStart = Math.max(0, Math.min(length, segment.start));
        const localEnd = Math.max(localStart, Math.min(length, segment.end));
        if (localEnd <= localStart) continue;
        segments.push({
          ...segment,
          start: start + localStart,
          end: start + localEnd,
          words: segment.words
            ?.filter(
              (w) =>
                Number.isFinite(w.start) &&
                Number.isFinite(w.end) &&
                w.end > w.start &&
                w.start < length &&
                w.end > 0,
            )
            .map((w) => ({
              ...w,
              start: start + Math.max(0, w.start),
              end: start + Math.min(length, w.end),
            })),
        });
      }
      context = chunk
        .map((s) => s.text)
        .join(' ')
        .slice(-400);
      options.onProgress?.(i + 1, total);
    } finally {
      await fs.promises.rm(tmp, { force: true });
    }
  }
  return segments;
}

/** Convert to a 16kHz mono WAV via our bundled ffmpeg-static binary. Doing this
 * ourselves (rather than letting nodejs-whisper shell out to a system `ffmpeg`
 * on PATH) means local transcription doesn't depend on the user having one
 * installed — this project deliberately bundles its own for that reason. */
function toWhisperWav(inputPath: string): Promise<string> {
  const outPath = path.join(
    os.tmpdir(),
    `aicut-whisper-${crypto.randomUUID()}.wav`,
  );
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .setFfmpegPath(resolveFfmpegPath())
      .audioChannels(1)
      .audioFrequency(16000)
      .audioCodec('pcm_s16le')
      .noVideo()
      .output(outPath)
      .on('end', () => resolve(outPath))
      .on('error', reject)
      .run();
  });
}

/**
 * Runs the bundled whisper.cpp executable/model directly. Customer machines
 * need no compiler, download step, shell command, or system FFmpeg.
 */
export async function transcribeViaLocalWhisper(
  filePath: string,
  modelName = 'base.en',
  signal?: AbortSignal,
): Promise<TranscriptSegment[]> {
  signal?.throwIfAborted();
  const runtime = resolveLocalWhisper(modelName);

  const wavPath = await toWhisperWav(filePath);
  // whisper-cli's default output naming APPENDS the extension to the full
  // input filename (foo.wav -> foo.wav.srt) rather than replacing it —
  // confirmed against real whisper-cli output, not documentation.
  const srtPath = `${wavPath}.srt`;
  const jsonPath = `${wavPath}.json`;
  try {
    signal?.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        runtime.executable,
        [
          '-m',
          runtime.model,
          '-f',
          wavPath,
          '-of',
          wavPath,
          '-osrt',
          '-ojf',
          '-t',
          String(Math.max(1, Math.min(4, os.cpus().length))),
        ],
        { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
      );
      let detail = '';
      const abort = () => {
        child.kill();
      };
      const timeout = setTimeout(
        () => {
          detail = 'Local transcription timed out';
          child.kill();
        },
        60 * 60 * 1000,
      );
      signal?.addEventListener('abort', abort, { once: true });
      child.stderr.on('data', (chunk) => {
        detail = (detail + String(chunk)).slice(-4000);
      });
      child.once('error', (error) => {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
        reject(error);
      });
      child.once('close', (code) => {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
        if (signal?.aborted) reject(new Error('Local transcription cancelled'));
        else if (code === 0) resolve();
        else
          reject(new Error(`Local transcription failed (${code}): ${detail}`));
      });
      if (signal?.aborted) abort();
    });
    if (!fs.existsSync(srtPath)) throw new Error('no_srt_output');
    const segments = parseSrtOrVtt(fs.readFileSync(srtPath, 'utf8'));
    const words = fs.existsSync(jsonPath)
      ? parseWhisperCppJsonWords(fs.readFileSync(jsonPath, 'utf8'))
      : [];
    return words.length ? attachWordsToSegments(segments, words) : segments;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `local_whisper_failed: ${detail}. Supply an SRT/VTT transcript or configure cloud transcription in Settings.`,
    );
  } finally {
    fs.rm(wavPath, () => {});
    fs.rm(srtPath, () => {});
    fs.rm(jsonPath, () => {});
  }
}
