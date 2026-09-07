// Real Electron/renderer smoke test with an isolated profile and simulated AI.
// Run after `npx vite build`: node scripts/smoke-stabilization.mjs
import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = path.join(root, 'test-results');
await fs.mkdir(results, { recursive: true });
const run = await fs.mkdtemp(path.join(results, 'stabilization-'));
const profile = path.join(run, 'profile');
await fs.mkdir(path.join(profile, 'projects'), { recursive: true });
await fs.writeFile(
  path.join(profile, 'config.json'),
  JSON.stringify({
    mas: { settings: { ai: { key: { openai: 'smoke-only-fake-key' } } } },
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
  mediaLibrary: [],
};
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
  console.log(
    'PASS: isolated app boot, Windows credential encryption/migration, protected IPC, browser CORS/API, Auto-Edit exclusions/reorder, undo/redo, rejection, autosave.',
  );
  console.log(`Smoke artifacts: ${run}`);
} finally {
  if (app) await app.close();
}
