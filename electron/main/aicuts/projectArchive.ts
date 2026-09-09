import { ipcMain, app, dialog, BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import type { ProjectFileV1 } from './projects';
import { saveProjectFile, readProjectFile } from './projectStorage';
import {
  ARCHIVE_MEDIA_DIR,
  ARCHIVE_SCHEMA,
  collectMediaSources,
  remapProjectMedia,
} from '../../../commont/projectArchive';

function runPowerShell(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const ps = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...args],
      { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let err = '';
    ps.stderr.on('data', (c) => (err = (err + c).slice(-4000)));
    ps.on('error', reject);
    ps.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Archive step failed (${code}): ${err}`)),
    );
  });
}

const compress = (source: string, destination: string) =>
  runPowerShell([
    '-Command',
    `Compress-Archive -Path ${JSON.stringify(source + path.sep + '*')} -DestinationPath ${JSON.stringify(destination)} -Force`,
  ]);
const expand = (zip: string, destination: string) =>
  runPowerShell([
    '-Command',
    `Expand-Archive -Path ${JSON.stringify(zip)} -DestinationPath ${JSON.stringify(destination)} -Force`,
  ]);

function keyFor(src: string): string {
  const hash = createHash('sha1').update(src).digest('hex').slice(0, 12);
  const base = path
    .basename(src)
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(-80);
  return `${hash}-${base || 'media'}`;
}

async function mkdtemp(prefix: string) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

/** Bundle a project + every referenced media file into one .zip. */
export async function exportProjectArchive(
  project: ProjectFileV1,
  destinationZip: string,
): Promise<{ missing: string[] }> {
  const staging = await mkdtemp('uscut-archive-');
  try {
    const mediaDir = path.join(staging, ARCHIVE_MEDIA_DIR);
    await fs.mkdir(mediaDir, { recursive: true });
    const map = new Map<string, string>();
    const missing: string[] = [];
    for (const src of collectMediaSources(project)) {
      try {
        const key = keyFor(src);
        await fs.copyFile(src, path.join(mediaDir, key));
        map.set(src, `${ARCHIVE_MEDIA_DIR}/${key}`);
      } catch {
        missing.push(src);
      }
    }
    const remapped = remapProjectMedia(project, (src) => map.get(src));
    await fs.writeFile(
      path.join(staging, 'project.json'),
      JSON.stringify(
        {
          schema: ARCHIVE_SCHEMA,
          exportedAt: new Date().toISOString(),
          project: remapped,
        },
        null,
        2,
      ),
      'utf8',
    );
    await fs.rm(destinationZip, { force: true });
    await compress(staging, destinationZip);
    return { missing };
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

function parseArchivedProject(raw: string): ProjectFileV1 {
  const value = JSON.parse(raw);
  const project = value?.project ?? value;
  if (
    project?.version !== 1 ||
    typeof project.id !== 'string' ||
    typeof project.name !== 'string' ||
    !Array.isArray(project.tracks) ||
    !Array.isArray(project.mediaLibrary)
  )
    throw new Error('This file is not a USCut project archive.');
  return project;
}

/** Restore a .zip into a fresh project + its own media folder. */
export async function importProjectArchive(
  zipPath: string,
  restoreRoot: string,
): Promise<ProjectFileV1> {
  const staging = await mkdtemp('uscut-restore-');
  try {
    await expand(zipPath, staging);
    const project = parseArchivedProject(
      await fs.readFile(path.join(staging, 'project.json'), 'utf8'),
    );
    const newId = randomUUID();
    const mediaTarget = path.join(restoreRoot, newId);
    await fs.mkdir(mediaTarget, { recursive: true });
    let restored: string[] = [];
    try {
      restored = await fs.readdir(path.join(staging, ARCHIVE_MEDIA_DIR));
    } catch {
      restored = [];
    }
    for (const name of restored)
      await fs.copyFile(
        path.join(staging, ARCHIVE_MEDIA_DIR, name),
        path.join(mediaTarget, name),
      );
    const remapped = remapProjectMedia(project, (src) => {
      const rel = src.replace(/\\/g, '/');
      if (!rel.startsWith(`${ARCHIVE_MEDIA_DIR}/`)) return undefined;
      return path.join(mediaTarget, rel.slice(ARCHIVE_MEDIA_DIR.length + 1));
    });
    return {
      ...remapped,
      id: newId,
      name: `${project.name} (restored)`.slice(0, 200),
      savedAt: new Date().toISOString(),
    };
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

export function registerProjectArchiveHandlers(win: BrowserWindow) {
  const restoreRoot = path.join(app.getPath('userData'), 'restored-media');
  const projectsDir = path.join(app.getPath('userData'), 'projects');
  const ID = /^[a-zA-Z0-9-]{1,100}$/;

  ipcMain.handle('aicuts:project-archive-export', async (_, id: unknown) => {
    if (typeof id !== 'string' || !ID.test(id))
      throw new Error('Invalid project id');
    const { project } = await readProjectFile(
      path.join(projectsDir, `${id}.json`),
    );
    const result = await dialog.showSaveDialog(win, {
      title: 'Back up project (with media)',
      defaultPath: `${(project?.name || 'project').replace(/[^\w.-]+/g, '_')}.uscut.zip`,
      filters: [{ name: 'USCut project archive', extensions: ['zip'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const { missing } = await exportProjectArchive(project, result.filePath);
    return { canceled: false, path: result.filePath, missing };
  });

  ipcMain.handle('aicuts:project-archive-import', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Restore project from backup',
      properties: ['openFile'],
      filters: [{ name: 'USCut project archive', extensions: ['zip'] }],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const project = await importProjectArchive(
      result.filePaths[0],
      restoreRoot,
    );
    await saveProjectFile(
      path.join(projectsDir, `${project.id}.json`),
      project,
    );
    return { canceled: false, id: project.id, name: project.name };
  });
}
