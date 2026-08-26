import ffmpeg from 'fluent-ffmpeg';
import sharp from 'sharp';
import { resolveFfmpegPath } from '../../util/ffmpegBinary';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import type { ListingStore } from './listingStore';
import type { PropertyListingSummary } from './types';
import { downloadPhoto } from './photoDownload';
import { formatPrice } from './video/format';
import { selectPriceTier, type PriceTier } from './video/priceTier';
import { assignPhotoBuckets } from './video/roomBuckets';
import { buildReelNarrationScript } from './video/narrationScript';
import { buildReelTimeline } from './video/reelTimeline';
import { resolveCaptionStyle } from './video/captionStyle';
import { synthesizeNarrationKokoro } from './video/kokoroNarration';
import { selectMusicTrack } from './video/musicBed';
import { probeVideo, exportProject } from '../aicuts/ffmpegOps';

ffmpeg.setFfmpegPath(resolveFfmpegPath());

const OUT_W = 1080;
const OUT_H = 1920;
const FPS = 30;

export interface ListingVideoOptions {
  maxPhotos?: number;
  secondsPerPhoto?: number;
  /** Windows SAPI text-to-speech narration (default true on win32). */
  narration?: boolean;
  /** Replaces the default 'DM us to schedule a showing' CTA card line. */
  ctaText?: string;
  /** Replaces the auto-generated spoken narration script (see buildNarrationScript). */
  narrationScript?: string;
  /**
   * Indexes into the listing's photoUrls, in the order they should appear —
   * lets a curator (agent or future auto-ranking step) pick and order the
   * best shots instead of taking Zillow's raw photo order. Indexes outside
   * the photo array are ignored; defaults to the first `maxPhotos` in order.
   */
  photoOrder?: number[];
  /**
   * 'legacy' (default): today's single Ken-Burns-per-photo pipeline.
   * 'reel-spec': the 6-block hook/kitchen/living/primary+bath/money-shot/CTA
   * template with per-price-tier transitions and captions, rendered through
   * the shared timeline engine (electron/main/aicuts).
   */
  reelTemplate?: 'legacy' | 'reel-spec';
  /** reel-spec only. 'auto' (default) picks by listing price ($600k threshold). */
  priceTier?: 'auto' | PriceTier;
  /** reel-spec only. Overrides the auto "POV: [hook]" hook-frame line. */
  hookText?: string;
  /**
   * reel-spec only. 'auto' (default): Kokoro if its model is available
   * (cached or reachable), else SAPI, else none. SAPI stays the zero-setup
   * fallback — Kokoro's model is a first-run download.
   */
  narrationEngine?: 'auto' | 'kokoro' | 'sapi' | 'none';
  /** reel-spec only. Kokoro voice id (see video/kokoroNarration.ts); ignored for SAPI. */
  narrationVoice?: string;
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
 * Ken Burns filter_complex graph for one still photo → OUT_WxOUT_H video
 * segment. Even indexes slowly zoom in from center; odd indexes pan across
 * at a fixed zoom. Exported for tests.
 *
 * Real estate photos are landscape; forcing one to fill a 1080x1920 portrait
 * frame edge-to-edge (the old approach: scale-to-cover + crop) upscales it
 * roughly 5-6x and throws away most of its width — badly pixelating even
 * Zillow's largest served photo size. Instead this composites the full,
 * uncropped photo — sharp, barely upscaled if at all — over a blurred,
 * darkened, cover-cropped copy of the same photo filling the rest of the
 * frame: the "echo pillarbox" technique CapCut and other short-form editors
 * use for landscape source photos in vertical video.
 */
export function buildKenBurnsFilter(
  index: number,
  seconds: number,
  banner: string,
): string {
  const frames = Math.round(seconds * FPS);
  const zoom =
    index % 2 === 0
      ? `zoompan=z='min(1.0015^on,1.13)':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=${frames}:s=${OUT_W}x${OUT_H}:fps=${FPS}`
      : `zoompan=z=1.13:x='(iw-iw/zoom)*on/${frames}':y='(ih-ih/zoom)/2':d=${frames}:s=${OUT_W}x${OUT_H}:fps=${FPS}`;
  const text = banner ? `,${drawtext(banner, 46, 'h-300')}` : '';
  return [
    `[0:v]split=2[bg][fg]`,
    `[bg]scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase,crop=${OUT_W}:${OUT_H},gblur=sigma=30,eq=brightness=-0.15[bgblur]`,
    `[fg]scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=decrease:flags=lanczos,unsharp=5:5:0.6:5:5:0.3[fgsharp]`,
    `[bgblur][fgsharp]overlay=(W-w)/2:(H-h)/2[composite]`,
    // Oversample the composite before zoompan to avoid jitter.
    `[composite]scale=${OUT_W * 2}:${OUT_H * 2}[oversample]`,
    `[oversample]${zoom},format=yuv420p${text}[outv]`,
  ].join(';');
}

/** Short spoken narration script for the reel. Exported for tests. */
export function buildNarrationScript(
  l: PropertyListingSummary,
  ctaText?: string,
): string {
  const loc = [l.city, l.state].filter(Boolean).join(', ');
  const parts = [`Just listed in ${loc}.`];
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
  parts.push(ctaText || 'Message us today to schedule your private showing.');
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

function renderPhotoSegment(
  photo: string,
  filterComplex: string,
  seconds: number,
  out: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(photo)
      .inputOptions(['-loop 1'])
      .complexFilter(filterComplex, 'outv')
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
    /** Directory of bundled reel-spec fonts (see video/captionStyle.ts). Injected — this file stays Electron-free, so it never resolves app-relative paths itself. */
    private readonly fontsDir: string | null = null,
    /** Directory Kokoro caches its downloaded ONNX model in (see video/kokoroNarration.ts). Injected for the same reason as fontsDir. */
    private readonly kokoroModelCacheDir: string | null = null,
    /** Directory of {standard,luxury}/ music subfolders (see video/musicBed.ts). Injected for the same reason as fontsDir. */
    private readonly musicDir: string | null = null,
  ) {}

  /** Prefer the listing's own synced folder (see listingFiles.ts) so a reel
   * lands alongside its photos/description; falls back to the constructor's
   * shared outputDir for rows captured before that feature existed or where
   * folder sync failed. */
  private resolveOutputDir(listing: PropertyListingSummary): string {
    return listing.filesFolder && fs.existsSync(listing.filesFolder)
      ? listing.filesFolder
      : this.outputDir;
  }

  async generateVideo(
    listingId: string,
    opts: ListingVideoOptions = {},
  ): Promise<ListingVideoResult | null> {
    const listing = await this.store.get(listingId);
    if (!listing) return null;

    const maxPhotos = Math.min(Math.max(opts.maxPhotos ?? 5, 1), 8);
    const perPhoto = Math.min(Math.max(opts.secondsPerPhoto ?? 3, 2), 6);
    const wantNarration = opts.narration ?? false;

    const work = path.join(os.tmpdir(), `aicut-reel-${crypto.randomUUID()}`);
    fs.mkdirSync(work, { recursive: true });

    try {
      if ((opts.reelTemplate ?? 'legacy') === 'reel-spec') {
        return await this.generateReelSpecVideo(listing, opts, work);
      }

      // 1. Photos — honor an agent-curated order/selection when supplied,
      // falling back to the raw scrape order otherwise.
      const allPhotoUrls = listing.photoUrls ?? [];
      const orderedPhotoUrls = opts.photoOrder
        ? opts.photoOrder
            .map((i) => allPhotoUrls[i])
            .filter((u): u is string => typeof u === 'string')
        : allPhotoUrls;
      const photoFiles: string[] = [];
      for (const [i, url] of orderedPhotoUrls.slice(0, maxPhotos).entries()) {
        const file = await downloadPhoto(url, work, i);
        if (file) photoFiles.push(file);
      }

      const price = formatPrice(listing.price);
      const cityState = [listing.city, listing.state].filter(Boolean).join(', ');
      const banner = [cityState, price].filter(Boolean).join('  •  ');
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
          ['JUST LISTED', cityState, price, specs].filter(Boolean),
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
          cityState,
          specs,
          '',
          opts.ctaText || 'DM us to schedule a showing',
        ].filter(Boolean),
        3,
        cta,
      );
      segments.push(cta);

      // 4. Optional narration
      let narrationWav: string | null = null;
      if (wantNarration) {
        narrationWav = await synthesizeNarration(
          opts.narrationScript || buildNarrationScript(listing, opts.ctaText),
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
      const outDir = this.resolveOutputDir(listing);
      fs.mkdirSync(outDir, { recursive: true });
      const outPath = path.join(
        outDir,
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

  /**
   * reel-spec template: classifies photos into the 6-block hook/kitchen/
   * living/primary+bath/money-shot structure and renders through the shared
   * timeline engine (electron/main/aicuts) instead of this file's own
   * concat-demuxer pipeline. `work` is owned/cleaned up by generateVideo().
   */
  private async generateReelSpecVideo(
    listing: PropertyListingSummary,
    opts: ListingVideoOptions,
    work: string,
  ): Promise<ListingVideoResult> {
    const maxPhotos = Math.min(Math.max(opts.maxPhotos ?? 8, 1), 8);
    const wantNarration = opts.narration ?? false;
    const tier: PriceTier =
      opts.priceTier && opts.priceTier !== 'auto'
        ? opts.priceTier
        : selectPriceTier(listing.price);

    // 1. Photos — same curated-order/select semantics as the legacy path,
    // but keeping each photo's caption paired through download so bucket
    // classification stays aligned with the downloaded (local-path) photo.
    const allPhotoUrls = listing.photoUrls ?? [];
    const allCaptions = listing.photoCaptions ?? [];
    const orderedIndexes = opts.photoOrder ?? allPhotoUrls.map((_, i) => i);
    const orderedPhotos = orderedIndexes
      .map((i) => ({ url: allPhotoUrls[i], caption: allCaptions[i] ?? null }))
      .filter(
        (p): p is { url: string; caption: string | null } =>
          typeof p.url === 'string',
      );

    const downloaded: { url: string; caption: string | null }[] = [];
    for (const [i, p] of orderedPhotos.slice(0, maxPhotos).entries()) {
      const file = await downloadPhoto(p.url, work, i);
      if (file) downloaded.push({ url: file, caption: p.caption });
    }

    const assignment = assignPhotoBuckets(downloaded);

    // 2. CTA card background — generated on the fly (no bundled asset yet).
    const ctaBackgroundImage = path.join(work, 'cta-bg.jpg');
    await sharp({
      create: {
        width: OUT_W,
        height: OUT_H,
        channels: 3,
        background: { r: 12, g: 12, b: 15 },
      },
    })
      .jpeg()
      .toFile(ctaBackgroundImage);

    // 3. Narration — Kokoro (warm local voice) when requested/available,
    // falling back to SAPI (zero-setup, but robotic) exactly like the
    // legacy template. 'none' skips narration entirely.
    let narration: { path: string; durationSeconds: number } | null = null;
    const narrationEngine = opts.narrationEngine ?? 'auto';
    if (wantNarration && narrationEngine !== 'none') {
      const script =
        opts.narrationScript ||
        buildReelNarrationScript(listing, assignment, {
          hookText: opts.hookText,
          ctaText: opts.ctaText,
        });

      if (narrationEngine === 'auto' || narrationEngine === 'kokoro') {
        if (this.kokoroModelCacheDir) {
          const kokoro = await synthesizeNarrationKokoro(
            script,
            work,
            this.kokoroModelCacheDir,
            opts.narrationVoice,
          );
          if (kokoro) narration = { path: kokoro.path, durationSeconds: kokoro.duration };
        }
      }

      if (!narration && narrationEngine !== 'kokoro') {
        const wav = await synthesizeNarration(
          script,
          path.join(work, 'narration.wav'),
        );
        if (wav) {
          const probed = await probeVideo(wav);
          narration = { path: wav, durationSeconds: probed.duration };
        }
      }
    }

    // 4. Build the timeline and render through the shared export pipeline.
    const captionStyle = resolveCaptionStyle(tier, this.fontsDir);
    const musicTrack = selectMusicTrack(tier, this.musicDir);
    const clips = buildReelTimeline(listing, assignment, {
      tier,
      hookText: opts.hookText,
      ctaText: opts.ctaText,
      ctaBackgroundImage,
      captionStyle,
      narration,
      // Renders silent-except-narration until Dale drops MP3s into
      // public/assets/music/{standard,luxury}/ — selectMusicTrack()
      // resolves null gracefully until then.
      music: musicTrack ? { path: musicTrack } : null,
    });

    const outDir = this.resolveOutputDir(listing);
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(
      outDir,
      `reel-${listing.id.slice(0, 8)}-${Date.now()}.mp4`,
    );
    await exportProject(clips, {
      outputPath: outPath,
      resolution: '1080p',
      aspect: '9:16',
      format: 'mp4',
      fps: FPS,
      fontsDir: this.fontsDir ?? undefined,
    });

    const photoClipCount = clips.filter(
      (c) => c.type === 'image' && c.id !== 'reel-cta-bg',
    ).length;
    const durationSeconds = clips.reduce(
      (max, c) =>
        c.type === 'audio' ? max : Math.max(max, c.startTime + c.duration),
      0,
    );

    return {
      listingId: listing.id,
      path: outPath,
      durationSeconds,
      photosUsed: photoClipCount,
      narrated: narration !== null,
    };
  }
}
