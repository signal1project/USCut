import { app, dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs/promises';
import { renameSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { JobManager } from '../jobs/jobManager';
import {
  exportProject,
  type TimelineClip,
  type ExportOptions,
} from './ffmpegOps';
import type { JobExecution } from '@mas/types';

const timing = z.number().finite().nonnegative();
const clipSchema = z
  .object({
    id: z.string(),
    src: z.string(),
    type: z.enum(['video', 'image', 'audio', 'caption']),
    duration: z.number().finite().positive(),
    startTime: timing,
    trimStart: timing,
    trimEnd: timing,
    speed: z.number().finite().positive().max(100).optional(),
    volume: z.number().finite().nonnegative().max(10).optional(),
    trackIndex: z.number().int().nonnegative().optional(),
  })
  .passthrough()
  .refine(
    (c) => c.trimStart + c.trimEnd < c.duration,
    'Clip trims consume the source',
  );
const optionsSchema = z.object({
  resolution: z.enum(['720p', '1080p', '4k']),
  aspect: z.enum(['16:9', '9:16', '1:1', '4:5']),
  format: z.enum(['mp4', 'mov']),
  fps: z.number().int().min(1).max(60),
  duckMusic: z.boolean().optional(),
});
type ExportInput = {
  clips: TimelineClip[];
  options: Omit<ExportOptions, 'outputPath' | 'onProgress' | 'signal'>;
  outputPath: string;
};

/** Render into a sibling temporary file, protecting an existing destination on failure. */
export async function runExportJob(
  input: ExportInput,
  context: JobExecution,
  render = exportProject,
): Promise<{ outputPath: string }> {
  const temporary = path.join(
    path.dirname(input.outputPath),
    `.uscut-render-${randomUUID()}${path.extname(input.outputPath)}`,
  );
  let committed = false;
  try {
    context.signal.throwIfAborted();
    context.report('Rendering video', 1);
    await render(input.clips, {
      ...input.options,
      outputPath: temporary,
      signal: context.signal,
      onProgress: (progress) =>
        context.report('Rendering video', Math.min(95, progress * 0.95)),
    });
    context.signal.throwIfAborted();
    context.report('Saving finished video', 98);
    // Windows virus scanners can briefly hold the completed output open.
    for (let attempt = 0; ; attempt++) {
      context.signal.throwIfAborted();
      try {
        renameSync(temporary, input.outputPath);
        committed = true;
        break;
      } catch (error) {
        if (
          attempt >= 9 ||
          !['EPERM', 'EACCES', 'EBUSY'].includes(
            (error as NodeJS.ErrnoException).code ?? '',
          )
        )
          throw error;
        await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
      }
    }
    return { outputPath: input.outputPath };
  } finally {
    if (!committed) await fs.unlink(temporary).catch(() => {});
  }
}

export function registerExportJobHandlers(
  win: Electron.BrowserWindow,
  outputDirectory: () => string,
) {
  const jobs = new JobManager<ExportInput, { outputPath: string }>(
    path.join(app.getPath('userData'), 'jobs', 'exports'),
    runExportJob,
  );
  const destinations = new Map<string, string>();
  ipcMain.handle('aicuts:export-jobs', () => jobs.list());
  ipcMain.handle('aicuts:export-job-cancel', (_, id: string) =>
    jobs.cancel(id),
  );
  ipcMain.handle('aicuts:export-job-reveal', async (_, id: string) => {
    const job = jobs.get(id);
    if (job?.status !== 'completed' || !job.result)
      throw new Error('Export has not completed');
    await fs.access(job.result.outputPath);
    shell.showItemInFolder(job.result.outputPath);
  });
  ipcMain.handle('aicuts:export-job-start', async (_, request: unknown) => {
    const parsed = z
      .object({
        clips: z.array(clipSchema).min(1).max(5000),
        options: optionsSchema,
        name: z.string().max(150),
      })
      .parse(request);
    if (!parsed.clips.some((c) => c.type === 'video' || c.type === 'image'))
      throw new Error('Add video or images before exporting');
    const directory = outputDirectory();
    await fs.mkdir(directory, { recursive: true });
    const result = await dialog.showSaveDialog(win, {
      title: 'Export Video',
      defaultPath: path.join(
        directory,
        `${parsed.name.replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 80) || 'USCut export'}.${parsed.options.format}`,
      ),
      filters: [
        {
          name: parsed.options.format.toUpperCase(),
          extensions: [parsed.options.format],
        },
      ],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const outputPath = result.filePath;
    const key = path.resolve(outputPath).toLowerCase();
    // Finished jobs release their reservation when a subsequent request arrives.
    for (const [reserved, jobId] of destinations) {
      if (
        !['queued', 'running', 'cancelling'].includes(
          jobs.get(jobId)?.status ?? '',
        )
      )
        destinations.delete(reserved);
    }
    if (destinations.has(key))
      throw new Error('An export is already writing to this file');
    if (
      parsed.clips.some(
        (c) => c.src && path.resolve(c.src).toLowerCase() === key,
      )
    )
      throw new Error('Choose an output file different from your source media');
    const job = jobs.submit(randomUUID(), `Export · ${key}`, {
      clips: parsed.clips as TimelineClip[],
      options: parsed.options,
      outputPath,
    });
    destinations.set(key, job.id);
    return { job };
  });
}
