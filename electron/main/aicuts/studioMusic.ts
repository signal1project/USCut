import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import ffmpeg from 'fluent-ffmpeg';
import { resolveFfmpegPath } from '../../util/ffmpegBinary';
import { probeVideo } from './ffmpegOps';

const AUDIO_EXTENSIONS = new Set([
  '.mp3',
  '.wav',
  '.m4a',
  '.aac',
  '.flac',
  '.ogg',
]);

export interface StudioMusicChoice {
  name: string;
  src: string;
}

/**
 * Lists audio files under a user-configured music directory (its root and any
 * one-level subfolders — e.g. the listing-reel `standard/` and `luxury/`
 * folders). Returns [] when the directory is missing, empty, or unset.
 */
export function listStudioMusic(musicDir: string | null): StudioMusicChoice[] {
  if (!musicDir) return [];
  const found: StudioMusicChoice[] = [];
  const scan = (dir: string, prefix: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (
        entry.isFile() &&
        AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
      )
        found.push({
          name: prefix ? `${prefix}/${entry.name}` : entry.name,
          src: full,
        });
      else if (entry.isDirectory() && !prefix) scan(full, entry.name);
    }
  };
  scan(musicDir, '');
  return found.slice(0, 200);
}

/** Longest bed we render — a longer timeline gets music then silence rather
 * than an unbounded re-encode of a looped short track. */
export const MAX_MUSIC_BED_SECONDS = 600;

/**
 * Renders a music bed to `targetSeconds` (capped) — looping a short track,
 * trimming a long one — with a 2s tail fade, so Studio's music track lines up
 * with the assembled timeline. Output is a self-contained AAC file in `outDir`.
 */
export async function prepareMusicBed(
  src: string,
  targetSeconds: number,
  outDir: string,
  signal?: AbortSignal,
): Promise<{ path: string; duration: number }> {
  if (!path.isAbsolute(src))
    throw new Error('Music must be a local absolute path');
  await fs.promises.access(src);
  signal?.throwIfAborted();
  const target = Math.max(1, Math.min(MAX_MUSIC_BED_SECONDS, targetSeconds));
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `studio-music-${randomUUID()}.m4a`);
  const fadeStart = Math.max(0, target - 2);
  await new Promise<void>((resolve, reject) => {
    const command = ffmpeg(src)
      .setFfmpegPath(resolveFfmpegPath())
      .inputOptions(['-stream_loop', '-1'])
      .outputOptions([
        '-t',
        target.toFixed(3),
        '-vn',
        '-af',
        `afade=t=out:st=${fadeStart.toFixed(3)}:d=2`,
        '-c:a',
        'aac',
        '-b:a',
        '192k',
      ])
      .output(out)
      .on('end', () => resolve())
      .on('error', reject);
    const abort = () => command.kill('SIGKILL');
    signal?.addEventListener('abort', abort, { once: true });
    command.run();
  });
  const probe = await probeVideo(out);
  return { path: out, duration: probe.duration || target };
}
