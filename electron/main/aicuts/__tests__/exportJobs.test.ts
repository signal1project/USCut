import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { resolveFfmpegPath } from '../../../util/ffmpegBinary';
import { runExportJob } from '../exportJobs';
import { exportProject } from '../ffmpegOps';
vi.mock('electron', () => ({ app: {}, dialog: {}, ipcMain: {}, shell: {} }));
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});
async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uscut-export-test-'));
  directories.push(dir);
  const outputPath = path.join(dir, 'finished.mp4');
  await fs.writeFile(outputPath, 'original');
  return {
    dir,
    input: {
      clips: [],
      outputPath,
      options: {
        resolution: '720p' as const,
        aspect: '16:9' as const,
        format: 'mp4' as const,
        fps: 24,
      },
    },
  };
}
describe('transactional export jobs', () => {
  it('replaces destination only after successful rendering', async () => {
    const { dir, input } = await fixture();
    const result = await runExportJob(
      input,
      { signal: new AbortController().signal, report: () => {} },
      async (_, options) => {
        expect(await fs.readFile(input.outputPath, 'utf8')).toBe('original');
        await fs.writeFile(options.outputPath, 'finished');
      },
    );
    expect(result.outputPath).toBe(input.outputPath);
    expect(await fs.readFile(input.outputPath, 'utf8')).toBe('finished');
    expect(await fs.readdir(dir)).toEqual(['finished.mp4']);
  });
  it.each(['failure', 'cancel'])(
    'preserves destination and removes partial output after %s',
    async (mode) => {
      const { dir, input } = await fixture();
      const controller = new AbortController();
      await expect(
        runExportJob(
          input,
          { signal: controller.signal, report: () => {} },
          async (_, options) => {
            await fs.writeFile(options.outputPath, 'partial');
            if (mode === 'cancel') controller.abort();
            else throw new Error('render failure');
          },
        ),
      ).rejects.toThrow();
      expect(await fs.readFile(input.outputPath, 'utf8')).toBe('original');
      expect(await fs.readdir(dir)).toEqual(['finished.mp4']);
    },
  );
  it('kills real FFmpeg during render and preserves an existing output', async () => {
    const { dir, input } = await fixture();
    const source = path.join(dir, 'source.mp4');
    execFileSync(
      resolveFfmpegPath(),
      [
        '-f',
        'lavfi',
        '-i',
        'color=c=blue:s=320x180:r=24:d=60',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-y',
        source,
      ],
      { windowsHide: true, stdio: 'ignore' },
    );
    const controller = new AbortController();
    const clips = [
      {
        id: 'video',
        src: source,
        type: 'video' as const,
        duration: 60,
        startTime: 0,
        trimStart: 0,
        trimEnd: 0,
      },
    ];
    let progressed = false;
    await expect(
      runExportJob(
        { ...input, clips },
        { signal: controller.signal, report: () => {} },
        async (items, options) => {
          await exportProject(items, {
            ...options,
            onProgress: () => {
              progressed = true;
              controller.abort();
            },
          });
        },
      ),
    ).rejects.toThrow('cancelled');
    expect(progressed).toBe(true);
    expect(await fs.readFile(input.outputPath, 'utf8')).toBe('original');
    expect((await fs.readdir(dir)).sort()).toEqual([
      'finished.mp4',
      'source.mp4',
    ]);
  }, 30000);
});
