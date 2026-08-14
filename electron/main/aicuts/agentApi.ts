/**
 * AICut Agent API — headless HTTP routes that let external AI agents (Omobono,
 * Apollo, any MCP client) drive the editor without the GUI.
 *
 * These mirror the interactive `aicuts:*` IPC handlers but take explicit file
 * paths instead of showing native dialogs, so they run unattended. Mounted under
 * `/api/aicut` by the embedded loopback server (see electron/main/server) and
 * protected by the same bearer token.
 */
import { Router } from 'express';
import path from 'node:path';
import os from 'node:os';
import { z } from 'zod';
import type { AIProvider } from '@mas/types';
import { asyncHandler, validateBody } from '../server/middleware';
import {
  probeVideo,
  getThumbnail,
  exportProject,
  type TimelineClip,
} from './ffmpegOps';
import { autoEdit, generateCaptionsFromTranscript } from './autoEdit';

const clipSchema = z.object({
  id: z.string(),
  src: z.string(),
  startTime: z.number(),
  trimStart: z.number(),
  trimEnd: z.number(),
  duration: z.number(),
  type: z.enum(['video', 'audio', 'caption']),
  captionText: z.string().optional(),
  volume: z.number().optional(),
});

export function createAicutAgentRouter(
  resolveProvider: () => AIProvider,
): Router {
  const router = Router();

  // Liveness / capability descriptor for agents
  router.get('/info', (_req, res) => {
    res.json({
      service: 'aicut',
      version: '0.1',
      capabilities: ['probe', 'thumbnail', 'auto-edit', 'captions', 'export'],
    });
  });

  // Probe a media file → { duration, width, height, hasAudio }
  router.post(
    '/probe',
    validateBody(z.object({ filePath: z.string() })),
    asyncHandler(async (req, res) => {
      res.json(await probeVideo(req.body.filePath));
    }),
  );

  // Generate a thumbnail at a timestamp → { path }
  router.post(
    '/thumbnail',
    validateBody(
      z.object({ filePath: z.string(), time: z.number().optional() }),
    ),
    asyncHandler(async (req, res) => {
      const out = await getThumbnail(req.body.filePath, req.body.time ?? 0);
      res.json({ path: out });
    }),
  );

  // AI auto-edit: returns trim/arrange decisions for the given clips
  router.post(
    '/auto-edit',
    validateBody(
      z.object({
        prompt: z.string(),
        clips: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            duration: z.number(),
            src: z.string(),
          }),
        ),
      }),
    ),
    asyncHandler(async (req, res) => {
      res.json(await autoEdit(req.body, resolveProvider()));
    }),
  );

  // Generate caption segments from a transcript
  router.post(
    '/captions',
    validateBody(
      z.object({ transcript: z.string(), clips: z.array(clipSchema) }),
    ),
    asyncHandler(async (req, res) => {
      res.json(
        await generateCaptionsFromTranscript(
          req.body.transcript,
          req.body.clips as TimelineClip[],
          resolveProvider(),
        ),
      );
    }),
  );

  // Headless export → renders to an explicit path (defaults to temp dir)
  router.post(
    '/export',
    validateBody(
      z.object({
        clips: z.array(clipSchema).min(1),
        outputPath: z.string().optional(),
        resolution: z.enum(['1080p', '4k', '720p']).default('1080p'),
        fps: z.number().default(30),
        format: z.enum(['mp4', 'mov']).default('mp4'),
      }),
    ),
    asyncHandler(async (req, res) => {
      const { clips, resolution, fps, format } = req.body;
      const outputPath =
        req.body.outputPath ??
        path.join(os.tmpdir(), `aicut-export-${Date.now()}.${format}`);
      await exportProject(clips as TimelineClip[], {
        resolution,
        fps,
        format,
        outputPath,
      });
      res.json({ success: true, outputPath });
    }),
  );

  return router;
}
