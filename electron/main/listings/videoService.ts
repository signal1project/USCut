import ffmpeg from 'fluent-ffmpeg';
import { resolveFfmpegPath } from '../../util/ffmpegBinary';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import type { ListingStore } from './listingStore';
import type { PropertyListingSummary } from './types';

ffmpeg.setFfmpegPath(resolveFfmpegPath());

const OUT_W = 1080;
const OUT_H = 1920;
const FPS = 30;

export interface ListingVideoOptions {
  maxPhotos?: number;
  secondsPerPhoto?: number;
  /** Windows SAPI text-to-speech narration (default true on win32). */
  narration?: boolean;
}

export interface ListingVideoResult {
  listingId: string;
  path: string;
  durationSeconds: number;
  photosUsed: number;
  narrated: boolean;
}

/** Escape a string for use inside an ffmpeg drawtext filter. */
export function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, '’') // typographic apostrophe avoids quote-nesting entirely
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%')
    .replace(/,/g, '\\,')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

function fontFile(): string | null {
  if (process.platform === 'win32') {
    for (const f of ['arialbd.ttf', 'arial.ttf', 'segoeui.ttf']) {
      const p = path.join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts', f);
      if (fs.existsSync(p)) return p;
    }
  } else if (process.platform === 'darwin') {
    const p = '/System/Library/Fonts/Helvetica.ttc';
    if (fs.existsSync(p)) return p;
  } else {
    const p = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function drawtext(
  text: string,
  fontsize: number,
  y: string,
  opts: { boxAlpha?: number } = {},
): string {
  const font = fontFile();
  const parts = [
    `text='${escapeDrawtext(text)}'`,
    font ? `fontfile='${font.replace(/\\/g, '/').replace(/:/g, '\\:')}'` : '',
    `fontsize=${fontsize}`,
    'fontcolor=white',
    'box=1',
    `boxcolor=black@${opts.boxAlpha ?? 0.55}`,
    'boxborderw=18',
    'x=(w-text_w)/2',
    `y=${y}`,
  ].filter(Boolean);
  return `drawtext=${parts.join(':')}`;
}

/**
 * Ken Burns filter for one still photo → OUT_WxOUT_H video segment.
 * Even indexes slowly zoom in from center; odd indexes pan across at a fixed
 * zoom. Exported for tests.
 */
export function buildKenBurnsFilter(
  index: number,
  seconds: number,
  banner: string,
): string {
  const frames = Math.round(seconds * FPS);
  // Oversample before zoompan to avoid jitter.
  const pre = `scale=${OUT_W * 2}:${OUT_H * 2}:force_original_aspect_ratio=increase,crop=${OUT_W * 2}:${OUT_H * 2}`;
  const zoom =
    index % 2 === 0
      ? `zoompan=z='min(1.0015^on,1.13)':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=${frames}:s=${OUT_W}x${OUT_H}:fps=${FPS}`
      : `zoompan=z=1.13:x='(iw-iw/zoom)*on/${frames}':y='(ih-ih/zoom)/2':d=${frames}:s=${OUT_W}x${OUT_H}:fps=${FPS}`;
  const text = banner ? `,${drawtext(banner, 46, 'h-300')}` : '';
  return `${pre},${zoom},format=yuv420p${text}`;
}

function formatPrice(cents: number | null): string {
  if (!cents) return '';
  const dollars = cents / 100;
  return dollars >= 1_000_000
    ? `$${(dollars / 1_000_000).toFixed(2)}M`
    : `$${dollars.toLocaleString()}`;
}

/** Short spoken narration script for the reel. Exported for tests. */
export function buildNarrationScript(l: PropertyListingSummary): string {
  const parts = [`Just listed. ${l.address}, ${l.city}, ${l.state}.`];
  const specs = [
    l.beds ? `${l.beds} bedrooms` : '',
    l.baths ? `${l.baths} baths` : '',
    l.sqft ? `${l.sqft.toLocaleString()} square feet` : '',
  ]
    .filter(Boolean)
    .join(', ');
  if (specs) parts.push(`${specs}.`);
  const price = formatPrice(l.price);
  if (price) parts.push(`Offered at ${price.replace('$', '')} dollars.`);
  parts.push('Message us today to schedule your private showing.');
  return parts.join(' ');
}

/** Windows SAPI TTS → WAV. Resolves null on any failure (narration is best-effort). */
function synthesizeNarration(
  text: string,
  outWav: string,
): Promise<string | null> {
  if (process.platform !== 'win32') return Promise.resolve(null);
  const script = [
    'Add-Type -AssemblyName System.Speech;',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;',
    `$s.SetOutputToWaveFile('${outWav.replace(/'/g, "''")}');`,
    `$s.Rate = 1;`,
    `$s.Speak('${text.replace(/'/g, "''")}');`,
    '$s.Dispose();',
  ].join(' ');
  return new Promise((resolve) => {
    const ps = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      {
        windowsHide: true,
      },
    );
    ps.on('error', () => resolve(null));
    ps.on('exit', (code) => {
      resolve(code === 0 && fs.existsSync(outWav) ? outWav : null);
    });
  });
}

async function downloadPhoto(
  url: string,
  dir: string,
  index: number,
): Promise<string | null> {
  try {
    if (!/^https?:\/\//i.test(url)) {
      // Local path (used by tests and manual captures).
      return fs.existsSync(url) && looksLikeRasterImage(url) ? url : null;
    }
    const parsed = new URL(url);
    const headers: Record<string, string> = {
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
    };
    if (/(^|\.)zillowstatic\.com$/i.test(parsed.hostname)) {
      headers.Referer = 'https://www.zillow.com/';
    }
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers,
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type')?.toLowerCase();
    if (contentType && !contentType.startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100) return null;
    const file = path.join(
      dir,
      `photo_${index}${path.extname(parsed.pathname) || '.jpg'}`,
    );
    fs.writeFileSync(file, buf);
    if (!looksLikeRasterImage(file)) {
      fs.rmSync(file, { force: true });
      return null;
    }
    return file;
  } catch {
    return null;
  }
}

/** Reject HTML/error bodies and malformed files before they can hang ffmpeg. */
function looksLikeRasterImage(file: string): boolean {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(16);
    const size = fs.readSync(fd, head, 0, head.length, 0);
    if (size < 4) return false;
    const ascii = head.toString('ascii');
    return (
      (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) || // JPEG
      head
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || // PNG
      (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') ||
      ascii.slice(4, 12).includes('ftypavif') ||
      ascii.startsWith('GIF8') ||
      ascii.startsWith('BM') ||
      ascii.startsWith('II*\0') ||
      ascii.startsWith('MM\0*')
    );
  } finally {
    fs.closeSync(fd);
  }
}

function renderPhotoSegment(
  photo: string,
  filter: string,
  seconds: number,
  out: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(photo)
      .inputOptions(['-loop 1'])
      .videoFilters(filter)
      .duration(seconds)
      .videoCodec('libx264')
      .noAudio()
      .outputOptions(['-preset fast', '-crf 20'])
      .output(out)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
}

function renderCardSegment(
  lines: string[],
  seconds: number,
  out: string,
): Promise<void> {
  const texts = lines
    .map((line, i) =>
      drawtext(
        line,
        i === 0 ? 58 : 44,
        `(h-text_h)/2+${(i - (lines.length - 1) / 2) * 130}`,
        { boxAlpha: 0 },
      ),
    )
    .join(',');
  return new Promise((resolve, reject) => {
    ffmpeg(`color=c=0x0c0c0f:s=${OUT_W}x${OUT_H}:d=${seconds}:r=${FPS}`)
      .inputFormat('lavfi')
      .videoFilters(`format=yuv420p${texts ? `,${texts}` : ''}`)
      .videoCodec('libx264')
      .noAudio()
      .outputOptions(['-preset fast', '-crf 20'])
      .output(out)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
}

function concatWithAudio(
  concatList: string,
  narrationWav: string | null,
  out: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let cmd = ffmpeg().input(concatList).inputOptions(['-f concat', '-safe 0']);
    if (narrationWav) {
      cmd = cmd
        .input(narrationWav)
        // Pad short narration with silence so -shortest ends at the video,
        // not halfway through a longer five-photo reel.
        .outputOptions([
          '-c:v copy',
          '-af apad',
          '-c:a aac',
          '-b:a 128k',
          '-shortest',
        ]);
    } else {
      cmd = cmd.outputOptions(['-c copy']);
    }
    cmd
      .outputOptions(['-movflags +faststart'])
      .output(out)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
}

/**
 * Turns a captured listing into a vertical 1080x1920 social reel:
 * ken-burns photo segments with an address/price banner, a closing CTA card,
 * and (on Windows) offline SAPI voiceover narration. Fully local — FFmpeg +
 * SAPI, no cloud calls, no API keys.
 */
export class ListingVideoService {
  constructor(
    private readonly store: ListingStore,
    private readonly outputDir: string,
  ) {}

  async generateVideo(
    listingId: string,
    opts: ListingVideoOptions = {},
  ): Promise<ListingVideoResult | null> {
    const listing = await this.store.get(listingId);
    if (!listing) return null;

    const maxPhotos = Math.min(Math.max(opts.maxPhotos ?? 5, 1), 8);
    const perPhoto = Math.min(Math.max(opts.secondsPerPhoto ?? 3, 2), 6);
    const wantNarration = opts.narration ?? process.platform === 'win32';

    const work = path.join(os.tmpdir(), `aicut-reel-${crypto.randomUUID()}`);
    fs.mkdirSync(work, { recursive: true });

    try {
      // 1. Photos
      const photoFiles: string[] = [];
      for (const [i, url] of (listing.photoUrls ?? [])
        .slice(0, maxPhotos)
        .entries()) {
        const file = await downloadPhoto(url, work, i);
        if (file) photoFiles.push(file);
      }

      const price = formatPrice(listing.price);
      const banner = [listing.address, price].filter(Boolean).join('  •  ');
      const specs = [
        listing.beds ? `${listing.beds} bd` : '',
        listing.baths ? `${listing.baths} ba` : '',
        listing.sqft ? `${listing.sqft.toLocaleString()} sqft` : '',
      ]
        .filter(Boolean)
        .join(' · ');

      // 2. Segments
      const segments: string[] = [];

      let renderedPhotoCount = 0;
      if (photoFiles.length > 0) {
        for (const [i, photo] of photoFiles.entries()) {
          const seg = path.join(work, `seg_${i}.mp4`);
          try {
            await renderPhotoSegment(
              photo,
              buildKenBurnsFilter(i, perPhoto, banner),
              perPhoto,
              seg,
            );
            segments.push(seg);
            renderedPhotoCount += 1;
          } catch {
            // A CDN can return a corrupt/unsupported image while the rest are
            // valid. Skip that photo instead of losing the whole reel.
          }
        }
      }

      if (renderedPhotoCount === 0) {
        // No photos — open with a title card instead.
        const intro = path.join(work, 'seg_intro.mp4');
        await renderCardSegment(
          [
            'JUST LISTED',
            listing.address,
            `${listing.city}, ${listing.state}`,
            price,
            specs,
          ].filter(Boolean),
          4,
          intro,
        );
        segments.push(intro);
      }

      // 3. CTA end card
      const cta = path.join(work, 'seg_cta.mp4');
      await renderCardSegment(
        [
          price || 'FOR SALE',
          listing.address,
          specs,
          '',
          'DM us to schedule a showing',
        ].filter(Boolean),
        3,
        cta,
      );
      segments.push(cta);

      // 4. Optional narration
      let narrationWav: string | null = null;
      if (wantNarration) {
        narrationWav = await synthesizeNarration(
          buildNarrationScript(listing),
          path.join(work, 'narration.wav'),
        );
      }

      // 5. Concat
      const concatList = path.join(work, 'concat.txt');
      fs.writeFileSync(
        concatList,
        segments
          .map((s) => `file '${s.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
          .join('\n'),
      );
      fs.mkdirSync(this.outputDir, { recursive: true });
      const outPath = path.join(
        this.outputDir,
        `reel-${listingId.slice(0, 8)}-${Date.now()}.mp4`,
      );
      await concatWithAudio(concatList, narrationWav, outPath);

      const photoSeconds =
        renderedPhotoCount > 0 ? renderedPhotoCount * perPhoto : 4;
      return {
        listingId,
        path: outPath,
        durationSeconds: photoSeconds + 3,
        photosUsed: renderedPhotoCount,
        narrated: narrationWav !== null,
      };
    } finally {
      fs.rm(work, { recursive: true, force: true }, () => {});
    }
  }
}
