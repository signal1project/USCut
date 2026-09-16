import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import type { ProbeResult } from './ffmpegOps';

/**
 * Chromium (Electron's renderer) can only decode a subset of codecs — notably
 * it has NO HEVC/H.265 decoder, which is the default codec on modern iPhones
 * and many Androids. Files like that import fine (FFmpeg reads them) but the
 * <video> element renders nothing.
 *
 * Strategy per imported file:
 *  - 'direct' — codec + container are renderer-safe, play the original file
 *  - 'remux'  — codecs fine, container not (e.g. h264 .mov/.mkv) → lossless
 *               stream-copy into .mp4 (takes ~seconds)
 *  - 'transcode' — codec undecodable (hevc, mpeg2, prores…) → H.264 720p-class
 *               preview proxy. Export always uses the ORIGINAL file.
 */
export type PreviewStrategy = 'direct' | 'remux' | 'transcode';

const PLAYABLE_VIDEO = new Set(['h264', 'vp8', 'vp9', 'av1']);
const PLAYABLE_AUDIO = new Set([
  'aac',
  'mp3',
  'opus',
  'vorbis',
  'flac',
  'pcm_s16le',
  'pcm_f32le',
]);
const SAFE_VIDEO_CONTAINERS = new Set(['.mp4', '.m4v', '.webm']);
const SAFE_AUDIO_CONTAINERS = new Set([
  '.mp3',
  '.wav',
  '.m4a',
  '.aac',
  '.flac',
  '.ogg',
]);

export function decidePreviewStrategy(
  probe: ProbeResult,
  srcPath: string,
): PreviewStrategy {
  const ext = path.extname(srcPath).toLowerCase();

  // Audio-only file
  if (!probe.width) {
    if (SAFE_AUDIO_CONTAINERS.has(ext)) return 'direct';
    return probe.audioCodec && PLAYABLE_AUDIO.has(probe.audioCodec)
      ? 'remux'
      : 'transcode';
  }

  const videoOk = !!probe.videoCodec && PLAYABLE_VIDEO.has(probe.videoCodec);
  const audioOk =
    !probe.hasAudio ||
    (!!probe.audioCodec && PLAYABLE_AUDIO.has(probe.audioCodec));

  if (videoOk && audioOk) {
    return SAFE_VIDEO_CONTAINERS.has(ext) ? 'direct' : 'remux';
  }
  return 'transcode';
}

/** Stable cache key: same source file (path + size + mtime) reuses its proxy. */
export function proxyCachePath(
  srcPath: string,
  stat: { size: number; mtimeMs: number },
  cacheDir: string,
): string {
  const hash = crypto
    .createHash('sha1')
    .update(`${srcPath}|${stat.size}|${Math.floor(stat.mtimeMs)}`)
    .digest('hex')
    .slice(0, 20);
  return path.join(cacheDir, `${hash}.mp4`);
}

function remuxToMp4(src: string, out: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(src)
      .outputOptions(['-c copy', '-movflags +faststart'])
      .output(out)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
}

function transcodeToProxy(
  src: string,
  out: string,
  opts: { hasVideo: boolean; hasAudio: boolean },
): Promise<void> {
  return new Promise((resolve, reject) => {
    let cmd = ffmpeg(src);
    if (opts.hasVideo) {
      cmd = cmd
        // Cap width at 1280 keeping aspect ratio; force even dimensions for h264.
        .videoFilters("scale='trunc(min(iw,1280)/2)*2':-2")
        .videoCodec('h264_mf')
        .outputOptions([
          '-rate_control pc_vbr',
          '-b:v 4M',
          '-maxrate 5M',
          '-pix_fmt yuv420p',
        ]);
    } else {
      cmd = cmd.noVideo();
    }
    cmd = opts.hasAudio
      ? cmd.audioCodec('aac').audioBitrate('128k')
      : cmd.noAudio();
    cmd
      .outputOptions(['-movflags +faststart'])
      .output(out)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
}

/**
 * Returns the path of a renderer-playable file for `srcPath`, or undefined if
 * the original is already directly playable. Proxies are cached in `cacheDir`
 * and reused across imports/sessions.
 */
export async function ensurePreviewMedia(
  srcPath: string,
  probe: ProbeResult,
  cacheDir: string,
): Promise<string | undefined> {
  const strategy = decidePreviewStrategy(probe, srcPath);
  if (strategy === 'direct') return undefined;

  fs.mkdirSync(cacheDir, { recursive: true });
  const stat = fs.statSync(srcPath);
  const out = proxyCachePath(srcPath, stat, cacheDir);
  if (fs.existsSync(out)) return out;

  const tmp = `${out}.part.mp4`;
  try {
    const shape = { hasVideo: !!probe.width, hasAudio: probe.hasAudio };
    if (strategy === 'remux') {
      try {
        await remuxToMp4(srcPath, tmp);
      } catch {
        // Some codec/container combos refuse stream copy — fall back to transcode.
        fs.rmSync(tmp, { force: true });
        await transcodeToProxy(srcPath, tmp, shape);
      }
    } else {
      await transcodeToProxy(srcPath, tmp, shape);
    }
    fs.renameSync(tmp, out);
    return out;
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}
