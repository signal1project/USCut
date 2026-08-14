import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import ffmpeg from 'fluent-ffmpeg';
import { resolveFfmpegPath } from '../../util/ffmpegBinary';

export interface TranscriptSegment {
  /** Seconds. */
  start: number;
  end: number;
  text: string;
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

/**
 * Transcribe an audio/video file with the OpenAI Whisper API
 * (verbose_json gives segment timestamps). ~25MB upload limit applies;
 * larger files should be pre-extracted to audio by the caller.
 */
export async function transcribeViaOpenAI(
  filePath: string,
  apiKey: string,
): Promise<TranscriptSegment[]> {
  const buf = fs.readFileSync(filePath);
  const form = new FormData();
  form.append('file', new Blob([buf]), path.basename(filePath));
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) throw new Error(`whisper_failed_${res.status}`);
  const data = (await res.json()) as {
    segments?: Array<{ start: number; end: number; text: string }>;
    text?: string;
    duration?: number;
  };
  if (data.segments?.length) {
    return data.segments.map((s) => ({
      start: s.start,
      end: s.end,
      text: s.text.trim(),
    }));
  }
  if (data.text)
    return [{ start: 0, end: data.duration ?? 60, text: data.text.trim() }];
  return [];
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
 * Transcribe locally with whisper.cpp (via nodejs-whisper) — no API key, no
 * upload, fully offline. `nodejs-whisper` is an optionalDependency: its
 * postinstall vendors whisper.cpp source but does NOT compile it, so it never
 * breaks `npm install`. Compiling whisper-cli + downloading the model both
 * happen lazily on first real use here, and both require a C++ build
 * toolchain (CMake + MSVC on Windows) — the same prerequisite already needed
 * for Mymo's virtual-camera phase. Absent that toolchain, this throws a clear,
 * actionable error rather than a stack trace.
 */
export async function transcribeViaLocalWhisper(
  filePath: string,
  modelName = 'base.en',
): Promise<TranscriptSegment[]> {
  let nodewhisper: (typeof import('nodejs-whisper'))['nodewhisper'];
  try {
    ({ nodewhisper } = await import('nodejs-whisper'));
  } catch {
    throw new Error(
      'local_whisper_not_installed: run `npm install` to pull in the optional nodejs-whisper dependency, or paste an SRT/VTT transcript, or set an OpenAI key in Settings.',
    );
  }

  const wavPath = await toWhisperWav(filePath);
  // whisper-cli's default output naming APPENDS the extension to the full
  // input filename (foo.wav -> foo.wav.srt) rather than replacing it —
  // confirmed against real whisper-cli output, not documentation.
  const srtPath = `${wavPath}.srt`;
  try {
    await nodewhisper(wavPath, {
      modelName,
      autoDownloadModelName: modelName,
      removeWavFileAfterTranscription: false,
      whisperOptions: {
        outputInSrt: true,
        outputInText: false,
        outputInVtt: false,
        outputInJson: false,
        outputInJsonFull: false,
        outputInCsv: false,
        outputInLrc: false,
        outputInWords: false,
      },
    });
    if (!fs.existsSync(srtPath)) throw new Error('no_srt_output');
    return parseSrtOrVtt(fs.readFileSync(srtPath, 'utf8'));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `local_whisper_failed: ${detail} — first run needs a C++ build toolchain ` +
        '(CMake + Visual Studio Build Tools on Windows) to compile whisper-cli and ' +
        'download the model. Paste an SRT/VTT transcript, or set an OpenAI key in ' +
        'Settings instead.',
    );
  } finally {
    fs.rm(wavPath, () => {});
    fs.rm(srtPath, () => {});
  }
}
