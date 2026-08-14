/**
 * Chrome Extension build script — uses esbuild (bundled with vite) directly.
 *
 * Service worker → ESM  (manifest.json declares "type": "module")
 * Content scripts → IIFE (Chrome isolated-world, no module loader available)
 * Popup script    → IIFE
 * Static files    → copied verbatim
 * Icons           → generated as solid-color PNGs
 */

import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { createDeflateRaw } from 'zlib';
import { promisify } from 'util';

const deflate = promisify(createDeflateRaw);
const EXT = 'chrome-extension';
const OUT = 'dist-ext';

// ── Clean ────────────────────────────────────────────────────────────────────
try { rmSync(OUT, { recursive: true, force: true }); } catch {}
mkdirSync(`${OUT}/background`, { recursive: true });
mkdirSync(`${OUT}/content`,    { recursive: true });
mkdirSync(`${OUT}/popup`,      { recursive: true });
mkdirSync(`${OUT}/icons`,      { recursive: true });

// ── TypeScript compilation ────────────────────────────────────────────────────
const sharedOpts = { bundle: true, platform: 'browser', target: 'chrome110' };

await build({
  ...sharedOpts,
  entryPoints: [`${EXT}/background/service-worker.ts`],
  outdir: `${OUT}/background`,
  format: 'esm',
});

await build({
  ...sharedOpts,
  entryPoints: [`${EXT}/content/zillow.ts`],
  outdir: `${OUT}/content`,
  format: 'iife',
});

await build({
  ...sharedOpts,
  entryPoints: [`${EXT}/popup/popup.ts`],
  outdir: `${OUT}/popup`,
  format: 'iife',
});

// ── Static assets ─────────────────────────────────────────────────────────────
// Bump the patch version on every build (persisted back to the checked-in
// manifest.json, not just the dist-ext copy) so Chrome's extensions page
// visibly shows a different version after "Load unpacked" or "Reload" —
// otherwise a stale, un-reloaded extension and a freshly rebuilt one look
// identical in Chrome, with no way to tell which one is actually running.
const manifest = JSON.parse(readFileSync(`${EXT}/manifest.json`, 'utf8'));
const [major, minor, patch] = manifest.version.split('.').map(Number);
manifest.version = `${major}.${minor}.${patch + 1}`;
writeFileSync(`${EXT}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
console.log(`  version -> ${manifest.version}`);

cpSync(`${EXT}/popup/popup.html`, `${OUT}/popup/popup.html`);

// ── Icon generation — solid emerald square ────────────────────────────────────
// AICut Listing Scraper accent: #34d399 emerald
const ICON_R = 52, ICON_G = 211, ICON_B = 153; // #34d399

function crc32(buf) {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  let c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type);
  const body    = Buffer.concat([typeBuf, data]);
  const crcBuf  = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(body));
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

async function makePng(size) {
  const sig  = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8]  = 8; // bit depth
  ihdr[9]  = 2; // RGB
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // Build raw scanlines: filter(0) + RGB pixels per row
  const row = Buffer.alloc(1 + size * 3);
  row[0] = 0; // no filter
  for (let x = 0; x < size; x++) {
    row[1 + x * 3]     = ICON_R;
    row[1 + x * 3 + 1] = ICON_G;
    row[1 + x * 3 + 2] = ICON_B;
  }
  const raw        = Buffer.concat(Array.from({ length: size }, () => row));
  const compressed = await new Promise((res, rej) => {
    const chunks = [];
    const d = createDeflateRaw();
    d.on('data', c => chunks.push(c));
    d.on('end',  ()  => res(Buffer.concat(chunks)));
    d.on('error', rej);
    d.end(raw);
  });

  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))]);
}

for (const size of [16, 48, 128]) {
  const png = await makePng(size);
  writeFileSync(`${OUT}/icons/icon${size}.png`, png);
}

console.log(`✓ Chrome Extension built → ${OUT}/`);
