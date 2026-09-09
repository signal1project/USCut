import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

/** Staging-dir name prefixes this app creates under the OS temp dir. Anything
 * matching these is transient and safe to remove once it is old enough. */
const TEMP_DIR_PREFIXES = [
  'uscut-archive-',
  'uscut-restore-',
  'uscut-studio-img-',
  'uscut-studio-music-',
  'aicut-studio-img-',
  'aicut-frames-',
  'aicut-clip-',
];

/** Partial render files (`runExportJob` / `exportJobs`) that were never renamed
 * onto their destination because the app crashed or was killed mid-render. */
const PARTIAL_RENDER = /^\.uscut-render-[0-9a-f-]+\./i;

const HOUR = 3600_000;

async function olderThan(entry: string, ms: number): Promise<boolean> {
  try {
    return Date.now() - (await fs.stat(entry)).mtimeMs > ms;
  } catch {
    return false;
  }
}

async function sweepTempDirs(maxAgeMs: number): Promise<number> {
  let removed = 0;
  let names: string[];
  try {
    names = await fs.readdir(os.tmpdir());
  } catch {
    return 0;
  }
  for (const name of names) {
    if (!TEMP_DIR_PREFIXES.some((p) => name.startsWith(p))) continue;
    const full = path.join(os.tmpdir(), name);
    if (!(await olderThan(full, maxAgeMs))) continue;
    try {
      await fs.rm(full, { recursive: true, force: true });
      removed++;
    } catch {
      /* another instance may hold it — leave it */
    }
  }
  return removed;
}

async function sweepPartialRenders(dir: string): Promise<number> {
  let removed = 0;
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return 0;
  }
  for (const name of entries) {
    if (!PARTIAL_RENDER.test(name)) continue;
    try {
      await fs.rm(path.join(dir, name), { force: true });
      removed++;
    } catch {
      /* still open — a concurrent render; skip */
    }
  }
  return removed;
}

/**
 * Best-effort startup GC for artifacts a crashed session can leave behind.
 * Only touches this app's own transient staging dirs and partial render files —
 * never finished output, project media, or anything a saved project references.
 */
export async function cleanupOrphanArtifacts(
  userDataDir: string,
): Promise<void> {
  try {
    const [dirs, sharePartials, exportDirPartials] = await Promise.all([
      sweepTempDirs(2 * HOUR),
      sweepPartialRenders(path.join(userDataDir, 'shares')),
      sweepPartialRenders(userDataDir),
    ]);
    const total = dirs + sharePartials + exportDirPartials;
    if (total)
      console.info(
        `[USCut] startup cleanup: removed ${total} orphaned staging item(s)`,
      );
  } catch (error) {
    console.warn('[USCut] startup cleanup failed (non-fatal):', error);
  }
}
