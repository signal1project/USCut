import { ipcMain, dialog, app } from 'electron';
import path from 'path';
import fs from 'node:fs';
import {
  probeVideo,
  getThumbnail,
  exportProject,
  type TimelineClip,
  type ExportOptions,
} from './ffmpegOps';
import { ensurePreviewMedia } from './previewProxy';
import { registerProjectHandlers } from './projects';
import { registerStudioHandlers } from './studio';
import { registerStudioDocHandlers } from './studioDocs';
import { registerProjectArchiveHandlers } from './projectArchive';
import { registerExportJobHandlers } from './exportJobs';
import {
  transcribeVideoAudio,
  synthesizeVoiceover,
  synthesizeVoiceoverElevenLabs,
  audioPeaks,
} from './audioTools';
import {
  transcribeViaLocalWhisper,
  type TranscriptSegment,
} from '../clips/transcription';
import {
  autoEdit,
  generateCaptionsFromTranscript,
  detectPlatform,
  type AutoEditInput,
} from './autoEdit';
import { Settings } from '../settings/settings';
import { settingsStore } from '../../global/store';
import { logger } from '../../global/log';
import { createProviderResolver } from '../ai';
import { GoogleTrendsFetcher } from '../research/googleTrendsFetcher';
import { assertLicensed } from '../licensing/guard';
import { JobManager } from '../jobs/jobManager';
import type { AutoEditResult } from './autoEdit';

/** Cap how many clips we pay to transcribe in one Auto-Edit call — enough for
 * a typical short project without runaway Whisper cost/latency on long timelines. */
const AUTO_EDIT_MAX_TRANSCRIBED_CLIPS = 6;

export function registerAiCutHandlers(win: Electron.BrowserWindow) {
  registerProjectHandlers();

  const settings = new Settings(settingsStore);
  registerExportJobHandlers(win, () => settings.getGeneralOutputDir());

  // Same provider-resolution the rest of the app uses (Settings → AI Providers)
  // — auto-edit and one-click captions must never talk to a hardcoded SDK.
  const resolveProvider = createProviderResolver(settings);
  registerStudioHandlers(settings, resolveProvider, () =>
    settings.getMusicDir(),
  );
  registerStudioDocHandlers();
  registerProjectArchiveHandlers(win);
  const proxyCacheDir = path.join(app.getPath('userData'), 'preview-proxies');
  const thumbsDir = path.join(app.getPath('userData'), 'thumbs');
  const voiceoverDir = path.join(app.getPath('userData'), 'voiceovers');
  const waveformCacheDir = path.join(app.getPath('userData'), 'waveforms');

  // One-click captions: extract audio → Whisper (OpenAI key if set, otherwise
  // free local whisper.cpp — same fallback chain as Auto-Clip). Runs as a
  // durable job (same JobManager Auto-Clip/Studio use) so it survives a
  // restart and can be cancelled instead of blocking on one long IPC call.
  const captionJobs = new JobManager<
    { videoPath: string },
    { segments: TranscriptSegment[] }
  >(path.join(app.getPath('userData'), 'jobs', 'captions'), async (input, context) => {
    context.report('Transcribing audio', 10);
    const key = settings.getProviderSettings('openai')?.apiKey;
    const segments = key
      ? await transcribeVideoAudio(input.videoPath, key)
      : await transcribeViaLocalWhisper(input.videoPath, 'base.en', context.signal);
    context.signal.throwIfAborted();
    return { segments };
  });
  ipcMain.handle('aicuts:transcribe-video-jobs', () => captionJobs.list());
  ipcMain.handle('aicuts:transcribe-video-cancel', (_, id: string) =>
    captionJobs.cancel(id),
  );
  ipcMain.handle('aicuts:transcribe-video-start', (_, request: unknown) => {
    assertLicensed(settings);
    const { requestId, videoPath } = request as {
      requestId: string;
      videoPath: string;
    };
    return captionJobs.submit(requestId, 'Auto-Captions', { videoPath });
  });

  // Voice Studio: ElevenLabs when a key is configured (Settings), otherwise
  // the keyless Windows SAPI default — same result shape either way.
  ipcMain.handle('aicuts:tts', async (_, text: string, rate?: number) => {
    try {
      const elevenLabsKey = settings.getElevenLabsKey();
      if (elevenLabsKey) {
        assertLicensed(settings);
        return await synthesizeVoiceoverElevenLabs(
          text,
          voiceoverDir,
          elevenLabsKey,
          settings.getElevenLabsVoiceId(),
        );
      }
      return await synthesizeVoiceover(text, voiceoverDir, rate ?? 1);
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'TTS failed' };
    }
  });

  // Real waveform peaks (cached)
  ipcMain.handle('aicuts:audio-peaks', async (_, filePath: string) => {
    return audioPeaks(filePath, waveformCacheDir);
  });

  // Import video file(s) via dialog
  ipcMain.handle('aicuts:import-video', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Import Media',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'All Media',
          extensions: [
            'mp4',
            'mov',
            'avi',
            'mkv',
            'webm',
            'mts',
            'm4v',
            'mp3',
            'wav',
            'aac',
            'm4a',
            'flac',
            'ogg',
            'png',
            'jpg',
            'jpeg',
            'webp',
            'gif',
          ],
        },
        {
          name: 'Video',
          extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'mts', 'm4v'],
        },
        {
          name: 'Audio',
          extensions: ['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg'],
        },
        {
          name: 'Images',
          extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'],
        },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) return null;

    const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

    const items = await Promise.all(
      result.filePaths.map(async (filePath) => {
        try {
          // Images: no probe/proxy needed — the file is its own preview.
          if (IMAGE_EXTS.has(path.extname(filePath).toLowerCase())) {
            return {
              src: filePath,
              name: path.basename(filePath),
              duration: 5, // default on-timeline duration; trim to taste
              type: 'image',
              thumbnail: filePath,
              hasAudio: false,
            };
          }
          const probe = await probeVideo(filePath);
          // Persist thumbnails under userData (not tmp) so saved projects keep them.
          const thumbnail = await getThumbnail(filePath, 0, thumbsDir);
          // Phone footage (HEVC .mov etc.) isn't decodable by the renderer —
          // build/reuse a playable preview proxy. Export still uses the original.
          let previewSrc: string | undefined;
          try {
            previewSrc = await ensurePreviewMedia(
              filePath,
              probe,
              proxyCacheDir,
            );
          } catch (err) {
            logger.error('[AICut] preview proxy failed for', filePath, err);
          }
          return {
            src: filePath,
            name: path.basename(filePath),
            duration: probe.duration,
            width: probe.width,
            height: probe.height,
            type: probe.width ? 'video' : 'audio',
            thumbnail,
            hasAudio: probe.hasAudio,
            previewSrc,
          };
        } catch {
          return null;
        }
      }),
    );

    return items.filter(Boolean);
  });

  // Get thumbnail for a specific time
  ipcMain.handle(
    'aicuts:get-thumbnail',
    async (_, filePath: string, timeSeconds: number) => {
      return getThumbnail(filePath, timeSeconds);
    },
  );

  // Probe a video file
  ipcMain.handle('aicuts:probe-video', async (_, filePath: string) => {
    return probeVideo(filePath);
  });

  // Export project
  ipcMain.handle(
    'aicuts:export',
    async (
      _,
      clips: TimelineClip[],
      opts: Omit<ExportOptions, 'onProgress'>,
    ) => {
      const outputDir = settings.getGeneralOutputDir();
      fs.mkdirSync(outputDir, { recursive: true });
      const result = await dialog.showSaveDialog(win, {
        title: 'Export Video',
        defaultPath: path.join(outputDir, 'aicuts-export.mp4'),
        filters: [
          { name: 'MP4', extensions: ['mp4'] },
          { name: 'MOV', extensions: ['mov'] },
        ],
      });

      if (result.canceled || !result.filePath) return { canceled: true };

      try {
        await exportProject(clips, {
          ...opts,
          outputPath: result.filePath,
          onProgress: (pct) =>
            win.webContents.send('aicuts:export-progress', pct),
        });
        return { success: true, outputPath: result.filePath };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  );

  // The Share flow renders through the durable export JobManager
  // (aicuts:export-job-start { share: true }) — cancellable, crash-recorded,
  // and visible in the Export jobs panel like any other render.

  // Auto-edit via the user's configured AI provider. Grounds decisions in
  // real content (Whisper transcript, when an OpenAI key is set), platform
  // reach/algorithm guidance, and current trending topics — not just clip
  // names and a duration guess.
  // Durable job (same JobManager Auto-Clip/Studio use) so a multi-stage
  // Auto-Edit (transcribe several clips, check trends, call the AI provider)
  // survives a restart and can be cancelled instead of blocking on one call.
  const autoEditJobs = new JobManager<AutoEditInput, AutoEditResult>(
    path.join(app.getPath('userData'), 'jobs', 'auto-edit'),
    async (input, context) => {
      const openAiKey = settings.getProviderSettings('openai')?.apiKey;
      const transcripts: Record<string, TranscriptSegment[]> = {};
      let transcriptionFailed = false;
      const clipsToTranscribe = input.clips.slice(
        0,
        AUTO_EDIT_MAX_TRANSCRIBED_CLIPS,
      );
      for (let i = 0; i < clipsToTranscribe.length; i++) {
        context.signal.throwIfAborted();
        const clip = clipsToTranscribe[i];
        context.report(
          `Transcribing clip ${i + 1} of ${clipsToTranscribe.length}`,
          (10 * i) / clipsToTranscribe.length,
        );
        try {
          transcripts[clip.id] = openAiKey
            ? await transcribeVideoAudio(clip.src, openAiKey)
            : await transcribeViaLocalWhisper(
                clip.src,
                'base.en',
                context.signal,
              );
        } catch (err) {
          transcriptionFailed = true;
          logger.error(
            `[USCut] Auto-Edit: transcription failed for clip ${clip.id}`,
            err,
          );
        }
      }

      context.signal.throwIfAborted();
      context.report('Checking trending topics', 60);
      let trending: string[] | undefined;
      try {
        const signals = await new GoogleTrendsFetcher().fetch();
        trending = signals.slice(0, 10).map((s) => s.keyword);
      } catch {
        /* trending context is a nice-to-have, never block the edit */
      }

      context.signal.throwIfAborted();
      context.report('Asking your AI provider for edit decisions', 75);
      const result = await autoEdit(
        {
          ...input,
          transcripts: Object.keys(transcripts).length
            ? transcripts
            : undefined,
          trending,
          platform: input.platform ?? detectPlatform(input.prompt),
        },
        resolveProvider(),
      );
      context.signal.throwIfAborted();

      if (transcriptionFailed && !openAiKey) {
        result.summary +=
          ' (Local transcription failed for one or more clips — see logs. Falls back to an OpenAI API key in Settings if you have one.)';
      }
      return result;
    },
  );
  ipcMain.handle('aicuts:auto-edit-jobs', () => autoEditJobs.list());
  ipcMain.handle('aicuts:auto-edit-cancel', (_, id: string) =>
    autoEditJobs.cancel(id),
  );
  ipcMain.handle('aicuts:auto-edit-start', (_, request: unknown) => {
    assertLicensed(settings);
    const { requestId, ...input } = request as AutoEditInput & {
      requestId: string;
    };
    return autoEditJobs.submit(requestId, 'AI Auto-Edit', input);
  });

  // Generate captions from transcript
  ipcMain.handle(
    'aicuts:generate-captions',
    async (_, transcript: string, clips: TimelineClip[]) => {
      try {
        return await generateCaptionsFromTranscript(
          transcript,
          clips,
          resolveProvider(),
        );
      } catch (err: any) {
        return { error: err.message };
      }
    },
  );

  // Show save project dialog
  ipcMain.handle('aicuts:save-project', async (_, projectData: unknown) => {
    const outputDir = settings.getGeneralOutputDir();
    fs.mkdirSync(outputDir, { recursive: true });
    const result = await dialog.showSaveDialog(win, {
      title: 'Save Project',
      defaultPath: path.join(outputDir, 'aicuts-project.json'),
      filters: [{ name: 'AICut Project', extensions: ['aicuts.json'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const fsp = await import('fs/promises');
    await fsp.writeFile(result.filePath, JSON.stringify(projectData, null, 2));
    return { success: true, filePath: result.filePath };
  });

  // Open existing project
  ipcMain.handle('aicuts:open-project', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Open Project',
      filters: [{ name: 'AICut Project', extensions: ['aicuts.json', 'json'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const fs = await import('fs/promises');
    const raw = await fs.readFile(result.filePaths[0], 'utf-8');
    return JSON.parse(raw);
  });
}
