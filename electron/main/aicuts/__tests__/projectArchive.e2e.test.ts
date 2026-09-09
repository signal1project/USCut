import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { exportProjectArchive, importProjectArchive } from '../projectArchive';
import type { ProjectFileV1 } from '../projects';

/** Real PowerShell Compress-Archive / Expand-Archive round trip (Windows). */
describe.skipIf(process.platform !== 'win32')(
  'project archive — real zip round trip',
  () => {
    let work: string;
    let clip: string;
    let logo: string;

    beforeAll(async () => {
      work = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-archive-'));
      clip = path.join(work, 'clip.mp4');
      logo = path.join(work, 'logo.png');
      await fsp.writeFile(clip, Buffer.alloc(2048, 7));
      await fsp.writeFile(logo, Buffer.alloc(512, 3));
    });
    afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

    const project = (): ProjectFileV1 => ({
      version: 1,
      id: 'orig',
      name: 'Trip',
      savedAt: '2026-09-09T00:00:00Z',
      tracks: [
        {
          id: 't',
          clips: [
            { id: 'c1', src: clip, previewSrc: path.join(work, 'proxy.mp4') },
            { id: 'cap', src: '', captionText: 'x' },
          ],
        },
      ],
      mediaLibrary: [
        { id: 'm1', src: clip, name: 'Clip' },
        { id: 'm2', src: logo, name: 'Logo' },
        { id: 'gone', src: path.join(work, 'missing.mov'), name: 'Missing' },
      ],
    });

    it('bundles present media, reports missing, and restores to a fresh self-contained project', async () => {
      const zip = path.join(work, 'backup.uscut.zip');
      const { missing } = await exportProjectArchive(project(), zip);
      expect(missing).toEqual([path.join(work, 'missing.mov')]);
      expect(fs.existsSync(zip)).toBe(true);

      const restoreRoot = path.join(work, 'restored');
      const restored = await importProjectArchive(zip, restoreRoot);

      expect(restored.id).not.toBe('orig');
      expect(restored.name).toBe('Trip (restored)');
      const clip0 = (restored.tracks[0] as { clips: Record<string, unknown>[] })
        .clips[0];
      expect(
        String(clip0.src).startsWith(path.join(restoreRoot, restored.id)),
      ).toBe(true);
      expect('previewSrc' in clip0).toBe(false);
      expect(fs.existsSync(String(clip0.src))).toBe(true);
      expect(fs.readFileSync(String(clip0.src)).length).toBe(2048);

      // the still-missing file keeps its original (absolute) path, not a media/ ref
      const goneItem = restored.mediaLibrary.find((m) => m.id === 'gone');
      expect(goneItem?.src).toBe(path.join(work, 'missing.mov'));

      // library entries for the same source resolve to the same restored file
      const libClip = restored.mediaLibrary.find((m) => m.id === 'm1');
      expect(libClip?.src).toBe(clip0.src);
    }, 60000);
  },
);
