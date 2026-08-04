import { ipcMain, dialog, app } from 'electron';
import path from 'path';
import {
  probeVideo,
  getThumbnail,
  exportProject,
  type TimelineClip,
  type ExportOptions,
} from './ffmpegOps';
import { ensurePreviewMedia } from './previewProxy';
import { registerProjectHandlers } from './projects';
import {
  transcribeVideoAudio,
  synthesizeVoiceover,
  synthesizeVoiceoverElevenLabs,
  audioPeaks,
} from './audioTools';
import {
  autoEdit,
  generateCaptionsFromTranscript,
  type AutoEditInput,
} from './autoEdit';
import { Settings } from '../settings/settings';
import { store } from '../../global/store';
import { logger } from '../../global/log';

export function registerAiCutHandlers(win: Electron.BrowserWindow) {
  registerProjectHandlers();

  const settings = new Settings(store);
  const proxyCacheDir = path.join(app.getPath('userData'), 'preview-proxies');
  const thumbsDir = path.join(app.getPath('userData'), 'thumbs');
  const voiceoverDir = path.join(app.getPath('userData'), 'voiceovers');
  const waveformCacheDir = path.join(app.getPath('userData'), 'waveforms');

  // One-click captions: extract audio → Whisper (needs OpenAI key in Settings)
  ipcMain.handle('aicuts:transcribe-video', async (_, videoPath: string) => {
    try {
      const key = settings.getProviderSettings('openai')?.apiKey;
      if (!key) {
        return {
          error:
            'Auto-captions from audio need an OpenAI API key (Settings → AI Providers → OpenAI) for Whisper. You can also paste a transcript instead.',
        };
      }
      const segments = await transcribeVideoAudio(videoPath, key);
      return { segments };
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : 'Transcription failed',
      };
    }
  });

  // Voice Studio: ElevenLabs when a key is configured (Settings), otherwise
  // the keyless Windows SAPI default — same result shape either way.
  ipcMain.handle('aicuts:tts', async (_, text: string, rate?: number) => {
    try {
      const elevenLabsKey = settings.getElevenLabsKey();
      if (elevenLabsKey) {
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
      const result = await dialog.showSaveDialog(win, {
        title: 'Export Video',
        defaultPath: path.join(app.getPath('videos'), 'aicuts-export.mp4'),
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

  // Silent export for the Share flow — no save dialog, lands in userData/shares
  ipcMain.handle(
    'aicuts:export-for-share',
    async (
      _,
      clips: TimelineClip[],
      opts: Omit<ExportOptions, 'onProgress' | 'outputPath'>,
    ) => {
      try {
        const sharesDir = path.join(app.getPath('userData'), 'shares');
        const { mkdirSync } = await import('node:fs');
        mkdirSync(sharesDir, { recursive: true });
        const outputPath = path.join(sharesDir, `share-${Date.now()}.mp4`);
        await exportProject(clips, {
          ...opts,
          outputPath,
          onProgress: (pct) =>
            win.webContents.send('aicuts:export-progress', pct),
        });
        return { success: true, outputPath };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Export failed',
        };
      }
    },
  );

  // Auto-edit via Claude
  ipcMain.handle('aicuts:auto-edit', async (_, input: AutoEditInput) => {
    try {
      return await autoEdit(input);
    } catch (err: any) {
      return { error: err.message };
    }
  });

  // Generate captions from transcript
  ipcMain.handle(
    'aicuts:generate-captions',
    async (_, transcript: string, clips: TimelineClip[]) => {
      try {
        return await generateCaptionsFromTranscript(transcript, clips);
      } catch (err: any) {
        return { error: err.message };
      }
    },
  );

  // Show save project dialog
  ipcMain.handle('aicuts:save-project', async (_, projectData: unknown) => {
    const result = await dialog.showSaveDialog(win, {
      title: 'Save Project',
      defaultPath: path.join(app.getPath('documents'), 'aicuts-project.json'),
      filters: [{ name: 'AICut Project', extensions: ['aicuts.json'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const fs = await import('fs/promises');
    await fs.writeFile(result.filePath, JSON.stringify(projectData, null, 2));
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
