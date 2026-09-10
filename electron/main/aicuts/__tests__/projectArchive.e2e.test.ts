import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
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

    it('round-trips literal shell characters and safely replaces an existing backup', async () => {
      const zip = path.join(work, "backup $([int]7) ` ' [draft].zip");
      await fsp.writeFile(zip, 'previous backup');
      await exportProjectArchive(project(), zip);
      const restored = await importProjectArchive(
        zip,
        path.join(work, 'literal-restored'),
      );
      expect(restored.name).toBe('Trip (restored)');
      expect((await fsp.readFile(zip)).subarray(0, 2).toString()).toBe('PK');
    }, 60000);

    it('preserves the previous backup when a media read fails', async () => {
      const zip = path.join(work, 'preserved.zip');
      await fsp.writeFile(zip, 'previous backup');
      const invalid = project();
      invalid.mediaLibrary.push({
        id: 'directory',
        src: work,
        name: 'Not a file',
      });
      await expect(exportProjectArchive(invalid, zip)).rejects.toThrow();
      expect(await fsp.readFile(zip, 'utf8')).toBe('previous backup');
    }, 60000);

    it('rejects traversal and duplicate ZIP entries before restoring media', async () => {
      for (const names of [
        ['../escaped.txt'],
        ['project.json', 'project.json'],
      ]) {
        const zip = path.join(work, `invalid-${names.length}.zip`);
        const literal = (value: string) =>
          "'" + value.replace(/'/g, "''") + "'";
        execFileSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; $z = [System.IO.Compression.ZipFile]::Open(${literal(zip)}, 'Create'); try { ${names.map((name) => `$z.CreateEntry(${literal(name)}) | Out-Null;`).join(' ')} } finally { $z.Dispose() }`,
          ],
          { windowsHide: true },
        );
        const destination = path.join(work, `invalid-restore-${names.length}`);
        await expect(importProjectArchive(zip, destination)).rejects.toThrow(
          /Unexpected archive entry|Duplicate archive entry/,
        );
        expect(fs.existsSync(destination)).toBe(false);
        expect(fs.existsSync(path.join(work, 'escaped.txt'))).toBe(false);
      }
    }, 60000);

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
