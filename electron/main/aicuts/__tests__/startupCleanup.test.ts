import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanupOrphanArtifacts } from '../startupCleanup';

describe('cleanupOrphanArtifacts', () => {
  let userData: string;
  let staleTmp: string;
  let freshTmp: string;

  beforeEach(() => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-ud-'));
    fs.mkdirSync(path.join(userData, 'shares'), { recursive: true });
    // An old staging dir (2h+ old) and a fresh one.
    staleTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uscut-archive-'));
    fs.writeFileSync(path.join(staleTmp, 'x'), '1');
    const old = Date.now() - 3 * 3600_000;
    fs.utimesSync(staleTmp, old / 1000, old / 1000);
    freshTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uscut-restore-'));
  });

  afterEach(() => {
    for (const d of [userData, staleTmp, freshTmp])
      fs.rmSync(d, { recursive: true, force: true });
  });

  it('removes old staging dirs, keeps fresh ones, and deletes partial renders only', async () => {
    const sharePartial = path.join(
      userData,
      'shares',
      '.uscut-render-abc-123.mp4',
    );
    const finishedShare = path.join(userData, 'shares', 'share-final.mp4');
    const exportPartial = path.join(userData, '.uscut-render-def-456.mp4');
    fs.writeFileSync(sharePartial, 'partial');
    fs.writeFileSync(finishedShare, 'keep me');
    fs.writeFileSync(exportPartial, 'partial');

    await cleanupOrphanArtifacts(userData);

    expect(fs.existsSync(staleTmp)).toBe(false); // old staging dir gone
    expect(fs.existsSync(freshTmp)).toBe(true); // fresh staging dir kept
    expect(fs.existsSync(sharePartial)).toBe(false);
    expect(fs.existsSync(exportPartial)).toBe(false);
    expect(fs.existsSync(finishedShare)).toBe(true); // finished output untouched
  });

  it('never throws when the user-data dir is missing', async () => {
    await expect(
      cleanupOrphanArtifacts(path.join(userData, 'does-not-exist')),
    ).resolves.toBeUndefined();
  });
});
