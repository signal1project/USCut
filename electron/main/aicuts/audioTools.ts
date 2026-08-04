import ffmpeg from 'fluent-ffmpeg';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { v4 as uuidv4 } from 'uuid';
import {
  transcribeViaOpenAI,
  type TranscriptSegment,
} from '../clips/transcription';
import { probeVideo } from './ffmpegOps';

/**
 * Editor audio tools: one-click captions (extract audio → Whisper),
 * Windows SAPI voiceover (keyless TTS), and real waveform peaks for the
 * timeline. All best-effort and self-contained.
 */

/** Extract mono 16kHz mp3 (small enough for Whisper's 25MB cap) and transcribe. */
export async function transcribeVideoAudio(
  videoPath: string,
  apiKey: string,
): Promise<TranscriptSegment[]> {
  const tmp = path.join(os.tmpdir(), `aicut-whisper-${uuidv4()}.mp3`);
  await new Promise<void>((resolve, reject) => {
    ffmpeg(videoPath)
      .noVideo()
      .audioChannels(1)
      .audioFrequency(16000)
      .audioBitrate('48k')
      .output(tmp)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
  try {
    return await transcribeViaOpenAI(tmp, apiKey);
  } finally {
    fs.unlink(tmp, () => {});
  }
}

export interface VoiceoverResult {
  path: string;
  duration: number;
  name: string;
}

/** Windows SAPI text-to-speech → WAV in `outDir`. Throws off-platform. */
export async function synthesizeVoiceover(
  text: string,
  outDir: string,
  rate = 1,
): Promise<VoiceoverResult> {
  if (process.platform !== 'win32') {
    throw new Error('Voiceover uses Windows speech synthesis (win32 only).');
  }
  const clean = text.trim();
  if (!clean) throw new Error('Voiceover text is empty.');
  fs.mkdirSync(outDir, { recursive: true });
  const outWav = path.join(outDir, `voiceover-${uuidv4()}.wav`);
  const script = [
    'Add-Type -AssemblyName System.Speech;',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;',
    `$s.SetOutputToWaveFile('${outWav.replace(/'/g, "''")}');`,
    `$s.Rate = ${Math.max(-10, Math.min(10, Math.round(rate)))};`,
    `$s.Speak('${clean.replace(/'/g, "''")}');`,
    '$s.Dispose();',
  ].join(' ');

  await new Promise<void>((resolve, reject) => {
    const ps = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true },
    );
    ps.on('error', reject);
    ps.on('exit', (code) => {
      if (code === 0 && fs.existsSync(outWav)) resolve();
      else reject(new Error(`Speech synthesis failed (exit ${code}).`));
    });
  });

  const probe = await probeVideo(outWav);
  return {
    path: outWav,
    duration: probe.duration,
    name: `Voiceover: ${clean.slice(0, 32)}${clean.length > 32 ? '…' : ''}`,
  };
}

/** ElevenLabs text-to-speech → MP3 in `outDir`. Requires an API key (Settings
 * → Voice Studio); this is the upgrade path over the keyless SAPI default
 * above — same VoiceoverResult shape so the caller doesn't need to branch. */
export async function synthesizeVoiceoverElevenLabs(
  text: string,
  outDir: string,
  apiKey: string,
  voiceId: string,
): Promise<VoiceoverResult> {
  const clean = text.trim();
  if (!clean) throw new Error('Voiceover text is empty.');

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: clean,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      `ElevenLabs request failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`,
    );
  }

  fs.mkdirSync(outDir, { recursive: true });
  const outMp3 = path.join(outDir, `voiceover-${uuidv4()}.mp3`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outMp3, buf);

  const probe = await probeVideo(outMp3);
  return {
    path: outMp3,
    duration: probe.duration,
    name: `Voiceover: ${clean.slice(0, 32)}${clean.length > 32 ? '…' : ''}`,
  };
}

/** Bucket raw PCM into 0..1 peak values. Exported for tests. */
export function bucketPeaks(samples: Int16Array, buckets: number): number[] {
  if (samples.length === 0 || buckets <= 0) return [];
  const out: number[] = new Array(buckets).fill(0);
  const per = Math.max(1, Math.floor(samples.length / buckets));
  for (let b = 0; b < buckets; b++) {
    let max = 0;
    const start = b * per;
    const end = Math.min(samples.length, start + per);
    for (let i = start; i < end; i++) {
      const v = Math.abs(samples[i]);
      if (v > max) max = v;
    }
    out[b] = Math.min(1, max / 32768);
  }
  return out;
}

/**
 * Real waveform peaks for a media file (cached by path+size+mtime).
 * Decodes to 8kHz mono s16le and buckets the absolute peaks.
 */
export async function audioPeaks(
  filePath: string,
  cacheDir: string,
  buckets = 160,
): Promise<number[]> {
  fs.mkdirSync(cacheDir, { recursive: true });
  let cacheKey = filePath;
  try {
    const stat = fs.statSync(filePath);
    cacheKey = `${filePath}|${stat.size}|${Math.floor(stat.mtimeMs)}|${buckets}`;
  } catch {
    return [];
  }
  const cacheFile = path.join(
    cacheDir,
    `${crypto.createHash('sha1').update(cacheKey).digest('hex').slice(0, 20)}.json`,
  );
  try {
    return JSON.parse(fs.readFileSync(cacheFile, 'utf-8')) as number[];
  } catch {
    // cache miss
  }

  const tmp = path.join(os.tmpdir(), `aicut-peaks-${uuidv4()}.raw`);
  try {
    await new Promise<void>((resolve, reject) => {
      ffmpeg(filePath)
        .noVideo()
        .audioChannels(1)
        .audioFrequency(8000)
        .format('s16le')
        .output(tmp)
        .on('end', () => resolve())
        .on('error', reject)
        .run();
    });
    const buf = fs.readFileSync(tmp);
    const samples = new Int16Array(
      buf.buffer,
      buf.byteOffset,
      Math.floor(buf.byteLength / 2),
    );
    const peaks = bucketPeaks(samples, buckets);
    fs.writeFileSync(cacheFile, JSON.stringify(peaks));
    return peaks;
  } catch {
    return [];
  } finally {
    fs.unlink(tmp, () => {});
  }
}
