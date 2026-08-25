import path from 'node:path';
import fs from 'node:fs';

/**
 * Downloads a single listing photo (Zillow CDN or a local path, used by
 * tests/manual captures) into `dir` as `photo_${index}.<ext>`. Best-effort —
 * resolves null on any failure (bad URL, non-image content, corrupt body)
 * rather than throwing, so one bad photo never sinks a whole batch.
 */
export async function downloadPhoto(
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
export function looksLikeRasterImage(file: string): boolean {
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
