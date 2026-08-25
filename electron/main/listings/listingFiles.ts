import fs from 'node:fs';
import path from 'node:path';
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import type { Settings } from '../settings/settings';
import type { ListingStore } from './listingStore';
import type { PropertyListingSummary } from './types';
import { downloadPhoto } from './photoDownload';
import { formatPrice, formatSpecsShort } from './video/format';

const ILLEGAL_WINDOWS_CHARS = /[\\/:*?"<>|]/g;

function sanitizeFolderName(name: string): string {
  return name.replace(ILLEGAL_WINDOWS_CHARS, '').trim();
}

/**
 * "99 Bates Ave NE" -> "99 Bates". Falls back to the sanitized full address
 * when it doesn't start with a house number (e.g. a manual capture with a
 * non-standard address string).
 */
export function deriveFolderName(address: string): string {
  const trimmed = address.trim();
  const match = trimmed.match(/^(\d+)\s+(\S+)/);
  const name = match ? `${match[1]} ${match[2]}` : trimmed;
  return sanitizeFolderName(name) || 'listing';
}

/** Appends " (2)", " (3)"... until `path.join(root, name)` doesn't already exist. */
function resolveUniqueDir(root: string, baseName: string): string {
  let candidate = path.join(root, baseName);
  let n = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(root, `${baseName} (${n})`);
    n += 1;
  }
  return candidate;
}

async function moveDir(from: string, to: string): Promise<void> {
  try {
    await fs.promises.rename(from, to);
  } catch (err) {
    // EXDEV: source/destination are on different drives (e.g. the Zillow
    // Scraper folder setting changed since this listing's folder was
    // created) — fs.rename can't cross drives, fall back to copy + delete.
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    await fs.promises.cp(from, to, { recursive: true });
    await fs.promises.rm(from, { recursive: true, force: true });
  }
}

async function writeDescriptionDocx(
  listing: PropertyListingSummary,
  folder: string,
): Promise<void> {
  const loc = [listing.city, listing.state].filter(Boolean).join(', ');
  const heading = [listing.address, loc, listing.zip].filter(Boolean).join(', ');

  const detailLines = [
    formatPrice(listing.price),
    formatSpecsShort(listing),
    listing.daysOnMarket != null ? `${listing.daysOnMarket} days on market` : '',
    listing.listingUrl ?? '',
  ].filter(Boolean);

  const agentLines = [
    listing.agentName ? `Agent: ${listing.agentName}` : '',
    listing.agentPhone ? `Phone: ${listing.agentPhone}` : '',
    listing.agentEmail ? `Email: ${listing.agentEmail}` : '',
  ].filter(Boolean);

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: heading, heading: HeadingLevel.HEADING_1 }),
          ...detailLines.map((line) => new Paragraph({ text: line })),
          new Paragraph({ text: '' }),
          new Paragraph({
            children: [new TextRun({ text: 'Description', bold: true })],
          }),
          new Paragraph({ text: listing.description || 'No description captured.' }),
          ...(agentLines.length
            ? [
                new Paragraph({ text: '' }),
                new Paragraph({
                  children: [new TextRun({ text: 'Agent', bold: true })],
                }),
                ...agentLines.map((line) => new Paragraph({ text: line })),
              ]
            : []),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(path.join(folder, 'description.docx'), buffer);
}

/**
 * Keeps a real folder on disk (photos + description.docx) in sync with each
 * captured listing, and moves it to Archive instead of deleting it when the
 * listing is removed from the app.
 */
export class ListingFilesService {
  constructor(
    private readonly settings: Settings,
    private readonly store: ListingStore,
  ) {}

  /**
   * Called after every successful capture. Reuses listing.filesFolder if it
   * still exists on disk (so a plain re-capture of the same listing overwrites
   * in place); otherwise derives a fresh, collision-safe folder. Downloads
   * are best-effort — a failed photo is skipped, never thrown.
   */
  async syncListingFiles(listing: PropertyListingSummary): Promise<void> {
    const root = this.settings.getZillowScraperDir();
    fs.mkdirSync(root, { recursive: true });

    const reuseExisting =
      listing.filesFolder && fs.existsSync(listing.filesFolder);
    const folder = reuseExisting
      ? listing.filesFolder!
      : resolveUniqueDir(root, deriveFolderName(listing.address));

    fs.mkdirSync(folder, { recursive: true });
    if (!reuseExisting) {
      await this.store.setFilesFolder(listing.id, folder);
    }

    await Promise.all(
      listing.photoUrls.map((url, i) => downloadPhoto(url, folder, i)),
    );

    try {
      await writeDescriptionDocx(listing, folder);
    } catch (err) {
      console.error('[listings] failed to write description.docx', err);
    }
  }

  /**
   * Called after a listing is deleted (the caller must fetch the listing
   * BEFORE removing its DB row — filesFolder disappears with it). No-ops if
   * filesFolder is unset or the folder is already gone.
   */
  async archiveListingFiles(listing: PropertyListingSummary): Promise<void> {
    if (!listing.filesFolder || !fs.existsSync(listing.filesFolder)) return;

    const archiveRoot = path.join(this.settings.getZillowScraperDir(), 'Archive');
    fs.mkdirSync(archiveRoot, { recursive: true });
    const dest = resolveUniqueDir(archiveRoot, path.basename(listing.filesFolder));
    await moveDir(listing.filesFolder, dest);
  }
}
