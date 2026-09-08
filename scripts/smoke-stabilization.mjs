// Real Electron/renderer smoke test with an isolated profile and simulated AI.
// Run after `npx vite build`: node scripts/smoke-stabilization.mjs
import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = path.join(root, 'test-results');
await fs.mkdir(results, { recursive: true });
const run = await fs.mkdtemp(path.join(results, 'stabilization-'));
const profile = path.join(run, 'profile');
const requireCjs = createRequire(import.meta.url);
const sourceVideo = path.join(run, 'smoke-video.mp4');
execFileSync(
  requireCjs('ffmpeg-static'),
  [
    '-f',
    'lavfi',
    '-i',
    'color=c=blue:s=320x180:r=15:d=12',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-y',
    sourceVideo,
  ],
  { windowsHide: true, stdio: 'ignore' },
);
const output = path.join(run, 'output');
const music = path.join(run, 'music');
await fs.mkdir(path.join(music, 'standard'), { recursive: true });
await fs.mkdir(path.join(music, 'luxury'), { recursive: true });
execFileSync(
  requireCjs('ffmpeg-static'),
  [
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=1',
    '-y',
    path.join(music, 'standard', 'test.wav'),
  ],
  { windowsHide: true, stdio: 'ignore' },
);
await fs.copyFile(
  path.join(music, 'standard', 'test.wav'),
  path.join(music, 'luxury', 'test.wav'),
);
await fs.mkdir(output, { recursive: true });
await fs.mkdir(path.join(profile, 'projects'), { recursive: true });
await fs.writeFile(
  path.join(profile, 'config.json'),
  JSON.stringify({
    mas: {
      settings: {
        ai: { key: { openai: 'smoke-only-fake-key' } },
        storage: { generalOutputDir: output, zillowScraperDir: output },
      },
    },
  }),
);
const fixture = {
  version: 1,
  id: 'smoke-project',
  name: 'Stabilization smoke project',
  savedAt: new Date().toISOString(),
  zoom: 60,
  tracks: [
    {
      id: 'caption-track',
      type: 'caption',
      label: 'Captions',
      clips: ['a', 'b', 'c'].map((id, i) => ({
        id,
        trackId: 'caption-track',
        type: 'caption',
        src: '',
        name: `Caption ${id}`,
        captionText: id,
        duration: 5,
        startTime: i * 5,
        trimStart: 0,
        trimEnd: 0,
      })),
    },
  ],
  mediaLibrary: [
    {
      id: 'smoke-video',
      src: sourceVideo,
      name: 'smoke-video.mp4',
      duration: 12,
      type: 'video',
    },
  ],
};
const jobsDir = path.join(profile, 'jobs', 'auto-clip');
await fs.mkdir(jobsDir, { recursive: true });
await fs.writeFile(
  path.join(jobsDir, 'interrupted-fixture.json'),
  JSON.stringify({
    id: 'interrupted-fixture',
    label: 'Prior interrupted job',
    status: 'running',
    inputHash: 'fixture-hash',
    progress: 42,
    createdAt: new Date().toISOString(),
  }),
);
const projectFile = path.join(profile, 'projects', 'smoke-project.json');
await fs.writeFile(projectFile, JSON.stringify(fixture));

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return String(port);
}
const bootstrap = path.join(run, 'bootstrap.mjs');
await fs.writeFile(
  bootstrap,
  `import { app } from 'electron';
app.setPath('userData', ${JSON.stringify(profile)});
app.setPath('sessionData', ${JSON.stringify(profile)});
await import(${JSON.stringify(pathToFileURL(path.join(root, 'dist-electron/main/index.js')).href)});
`,
);
const env = {
  ...process.env,
  AICUT_CAPTURE_PORT: await freePort(),
  AICUT_BRIDGE_PORT: await freePort(),
  NODE_ENV: 'production',
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
let app;
try {
  app = await electron.launch({ args: [bootstrap], cwd: root, env });
  let page;
  await expect
    .poll(
      async () => {
        page = app.windows().find((p) => p.url().includes('index.html'));
        return Boolean(page);
      },
      { timeout: 30000 },
    )
    .toBe(true);
  await expect(page.getByText(fixture.name, { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect
    .poll(async () => {
      try {
        return Boolean(
          JSON.parse(
            await fs.readFile(path.join(profile, 'api-port.json'), 'utf8'),
          ).port,
        );
      } catch {
        return false;
      }
    })
    .toBe(true);
  const plain = await fs.readFile(path.join(profile, 'config.json'), 'utf8');
  const encrypted = JSON.parse(
    await fs.readFile(path.join(profile, 'uscut-ai-credentials.json'), 'utf8'),
  );
  const recovered = await app.evaluate(({ safeStorage }, ciphertext) => {
    return (
      JSON.parse(
        safeStorage.decryptString(Buffer.from(ciphertext, 'base64')),
      ) === 'smoke-only-fake-key'
    );
  }, encrypted.mas.settings.ai.key.openai);
  assert.equal(plain.includes('smoke-only-fake-key'), false);
  assert.equal(recovered, true);
  const protectedRead = await page.evaluate(async () => {
    try {
      await window.ipcRenderer.invoke('getStore', 'mas');
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(protectedRead, true);
  const browserApi = await page.evaluate(async () => {
    const info = await window.ipcRenderer.invoke('mas:api-info');
    const response = await fetch(`${info.baseUrl}/api/accounts`, {
      headers: { Authorization: `Bearer ${info.token}` },
    });
    return response.status;
  });
  assert.equal(browserApi, 200);
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('aicuts:auto-edit');
    ipcMain.handle('aicuts:auto-edit', (_event, input) => ({
      summary: 'Smoke edit applied.',
      decisions: [
        {
          clipId: input.clips[2].id,
          trimStart: 1,
          trimEnd: 1,
          startTime: 0,
          reason: 'Keep strongest',
        },
        {
          clipId: input.clips[0].id,
          trimStart: 1,
          trimEnd: 1,
          startTime: 3,
          reason: 'Close',
        },
      ],
    }));
  });
  await page.getByText(fixture.name, { exact: true }).click();
  await page.getByRole('button', { name: 'AI', exact: true }).click();
  await page
    .getByPlaceholder(
      'e.g. Make a 60-second highlight reel with the best moments',
    )
    .fill('Keep the strongest two moments');
  await page
    .getByRole('button', { name: 'Apply AI Edit', exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText('Smoke edit applied.');
  const savedClips = async () =>
    JSON.parse(await fs.readFile(projectFile, 'utf8')).tracks[0].clips;
  await expect
    .poll(async () => (await savedClips()).map((c) => c.id), { timeout: 10000 })
    .toEqual(['c', 'a']);
  await page.getByTitle('Undo (Ctrl+Z)', { exact: true }).click();
  await expect
    .poll(async () => (await savedClips()).map((c) => c.id))
    .toEqual(['a', 'b', 'c']);
  await page.getByTitle('Redo (Ctrl+Y)', { exact: true }).click();
  await expect
    .poll(async () => (await savedClips()).map((c) => c.id))
    .toEqual(['c', 'a']);
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('aicuts:auto-edit');
    ipcMain.handle('aicuts:auto-edit', () => ({
      summary: 'Bad timing',
      decisions: [
        {
          clipId: 'c',
          trimStart: -1,
          trimEnd: 0,
          startTime: 0,
          reason: 'invalid',
        },
      ],
    }));
  });
  await page
    .getByPlaceholder(
      'e.g. Make a 60-second highlight reel with the best moments',
    )
    .fill('Try another edit');
  await page
    .getByRole('button', { name: 'Apply AI Edit', exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText('invalid edit');
  assert.deepEqual(
    (await savedClips()).map((c) => c.id),
    ['c', 'a'],
  );
  await page.screenshot({ path: path.join(run, 'editor.png') });
  const jobsPanel = page.getByLabel('Auto-Clip jobs');
  await expect(
    jobsPanel.getByText('Prior interrupted job', { exact: true }),
  ).toBeVisible();
  await expect(jobsPanel).toContainText('interrupted');
  await page
    .getByPlaceholder(/Optional: paste SRT\/VTT/)
    .fill(
      '1\n00:00:00,000 --> 00:00:12,000\nHere are three surprising mistakes and the best way to fix them!',
    );
  await page
    .getByRole('button', { name: 'Find & Cut Clips', exact: true })
    .click();
  await expect(
    jobsPanel.getByRole('button', { name: 'Add clips to current project' }),
  ).toBeVisible({ timeout: 60000 });
  const beforeImport = JSON.parse(await fs.readFile(projectFile, 'utf8'))
    .mediaLibrary.length;
  assert.equal(beforeImport, 1);
  await jobsPanel
    .getByRole('button', { name: 'Add clips to current project' })
    .click();
  await expect
    .poll(
      async () =>
        JSON.parse(await fs.readFile(projectFile, 'utf8')).mediaLibrary.length,
    )
    .toBeGreaterThan(1);
  const afterImport = JSON.parse(await fs.readFile(projectFile, 'utf8'))
    .mediaLibrary.length;
  await jobsPanel
    .getByRole('button', { name: 'Add clips to current project' })
    .click();
  await page
    .getByTitle('Save project (Ctrl+S) — autosaves as you edit', {
      exact: true,
    })
    .click();
  await expect
    .poll(
      async () =>
        JSON.parse(await fs.readFile(projectFile, 'utf8')).mediaLibrary.length,
    )
    .toBe(afterImport);
  const cancelledJob = await page.evaluate(async (videoPath) => {
    const info = await window.ipcRenderer.invoke('mas:api-info');
    const headers = {
      Authorization: `Bearer ${info.token}`,
      'Content-Type': 'application/json',
    };
    const base = `${info.baseUrl}/api/clips/jobs`;
    const requestId = crypto.randomUUID();
    await fetch(base, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        requestId,
        videoPath,
        transcriptSrt:
          '1\n00:00:00,000 --> 00:00:12,000\nThe best surprising mistake and how to fix it!',
        maxClips: 1,
      }),
    });
    const response = await fetch(`${base}/${requestId}/cancel`, {
      method: 'POST',
      headers,
    });
    return { id: requestId, status: (await response.json()).status };
  }, sourceVideo);
  assert.ok(['cancelling', 'cancelled'].includes(cancelledJob.status));
  await expect
    .poll(
      async () =>
        JSON.parse(
          await fs.readFile(
            path.join(jobsDir, `${cancelledJob.id}.json`),
            'utf8',
          ),
        ).status,
    )
    .toBe('cancelled');
  await page.screenshot({ path: path.join(run, 'jobs.png') });
  await page.evaluate(() => {
    location.hash = '#/mas/settings';
  });
  await expect(
    page.getByText('Production readiness', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Refresh readiness' }),
  ).toBeEnabled({ timeout: 15000 });
  await page
    .getByLabel('Listing reel music folder', { exact: true })
    .fill(music);
  await page.getByRole('button', { name: 'Save music folder' }).click();
  await expect(
    page.getByText('Music folder saved. The next listing reel will use it.', {
      exact: true,
    }),
  ).toBeVisible();
  const readiness = await page.evaluate(() =>
    window.ipcRenderer.invoke('mas:settings:readiness'),
  );
  assert.equal(readiness.checks.find((c) => c.id === 'ffmpeg').status, 'ready');
  assert.equal(readiness.checks.find((c) => c.id === 'music').status, 'ready');
  await page
    .getByText('Production readiness', { exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(run, 'readiness.png') });
  await page.evaluate((src) => {
    localStorage.setItem(
      'uscut-studio-draft-v1',
      JSON.stringify({
        title: 'Studio smoke',
        brief: 'A clear introduction',
        assets: [
          {
            id: 'source',
            src,
            name: 'Blue footage',
            type: 'video',
            duration: 12,
          },
        ],
        scenes: [
          {
            assetId: 'source',
            sourceStart: 1,
            duration: 4,
            headline: 'Welcome',
            narration: 'Welcome to our studio.',
          },
        ],
      }),
    );
    location.hash = '#/mas/studio';
  }, sourceVideo);
  await expect(
    page.getByRole('heading', { name: 'Production Studio', exact: true }),
  ).toBeVisible();
  await page
    .getByLabel('Generate local Windows narration from scene scripts')
    .check();
  await page
    .getByRole('button', { name: 'Build editable video', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Open a copy in editor' }),
  ).toBeVisible({ timeout: 60000 });
  await page.screenshot({ path: path.join(run, 'studio.png') });
  const studioJobs = await page.evaluate(() =>
    window.ipcRenderer.invoke('aicuts:studio-jobs'),
  );
  const built = studioJobs.find(
    (job) => job.status === 'completed' && job.result?.kind === 'build',
  ).result.project;
  assert.equal(built.tracks[0].clips[0].trimStart, 1);
  assert.equal(built.tracks[1].clips[0].captionText, 'Welcome');
  assert.equal(built.tracks[2].clips.length, 1);
  assert.ok(built.tracks[2].clips[0].duration > 0);
  await fs.access(built.tracks[2].clips[0].src);
  await page.getByRole('button', { name: 'Open a copy in editor' }).click();
  await expect(
    page.getByText('Studio smoke', { exact: true }).first(),
  ).toBeVisible();
  const savedFiles = await fs.readdir(path.join(profile, 'projects'));
  const savedStudio = [];
  for (const file of savedFiles.filter((f) => f.endsWith('.json'))) {
    const saved = JSON.parse(
      await fs.readFile(path.join(profile, 'projects', file), 'utf8'),
    );
    if (saved.name === 'Studio smoke') savedStudio.push(saved);
  }
  assert.equal(savedStudio.length, 1);
  assert.notEqual(savedStudio[0].id, built.id);
  for (const aspect of ['9:16', '16:9']) {
    const exported = await page.evaluate(
      async ({ project, aspect }) => {
        const clips = project.tracks.flatMap((track, trackIndex) =>
          track.clips.map((clip) => ({
            ...clip,
            trackIndex,
            trackMuted: !!track.muted,
          })),
        );
        return window.ipcRenderer.invoke('aicuts:export-for-share', clips, {
          resolution: '720p',
          aspect,
          format: 'mp4',
          fps: 24,
        });
      },
      { project: savedStudio[0], aspect },
    );
    assert.equal(exported.success, true, exported.error);
    const probe = JSON.parse(
      execFileSync(
        requireCjs('@ffprobe-installer/ffprobe').path,
        [
          '-v',
          'quiet',
          '-show_streams',
          '-show_format',
          '-of',
          'json',
          exported.outputPath,
        ],
        { windowsHide: true, encoding: 'utf8' },
      ),
    );
    const video = probe.streams.find((s) => s.codec_type === 'video');
    assert.equal(video.width, aspect === '9:16' ? 720 : 1280);
    assert.equal(video.height, aspect === '9:16' ? 1280 : 720);
    assert.ok(probe.streams.some((s) => s.codec_type === 'audio'));
    assert.ok(Number(probe.format.duration) >= 3.9);
  }
  console.log(
    'PASS: Studio real media validation, local Windows narration, separate editable tracks, durable job result, opening a saved project copy.',
  );
  console.log(
    'PASS: isolated app boot, credential migration, protected IPC, browser CORS/API, Auto-Edit/undo/redo/autosave, interrupted job recovery, real FFmpeg Auto-Clip job, explicit deduplicated import, job cancellation, readiness, music configuration.',
  );
  console.log(`Smoke artifacts: ${run}`);
} finally {
  if (app) await app.close();
}
