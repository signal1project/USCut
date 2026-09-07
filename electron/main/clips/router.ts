import express, { type Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../server/middleware';
import type { ClipService } from './clipService';
import type { AutoClipInput, AutoClipResult } from './clipService';
import type { JobManager } from '../jobs/jobManager';
import path from 'node:path';

const autoClipSchema = z.object({
  videoPath: z.string().min(1),
  transcriptSrt: z.string().optional(),
  maxClips: z.number().int().min(1).max(8).optional(),
  clipSeconds: z.number().min(10).max(90).optional(),
  vertical: z.boolean().optional(),
  burnCaptions: z.boolean().optional(),
  query: z.string().max(200).optional(),
  trackSubject: z.boolean().optional(),
});

export function createClipsRouter(
  service: ClipService,
  jobs?: JobManager<AutoClipInput, AutoClipResult>,
): Router {
  const router = express.Router();
  if (jobs) {
    router.get('/jobs', (_req, res) => {
      res.json({ jobs: jobs.list() });
    });
    router.get('/jobs/:id', (req, res) => {
      const job = jobs.get(req.params.id);
      if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }
      res.json(job);
    });
    router.post(
      '/jobs',
      validateBody(autoClipSchema.extend({ requestId: z.string().uuid() })),
      asyncHandler(async (req, res) => {
        const { requestId, ...input } = req.body;
        const job = jobs.submit(
          requestId,
          path.basename(input.videoPath),
          input,
        );
        res.status(202).json(job);
      }),
    );
    router.post(
      '/jobs/:id/cancel',
      asyncHandler(async (req, res) => {
        const job = jobs.cancel(String(req.params.id));
        if (!job) {
          res.status(404).json({ error: 'Job not found' });
          return;
        }
        res.json(job);
      }),
    );
  }

  /**
   * POST /api/clips/auto — long video in, short vertical highlight clips out,
   * ranked by score. Transcript via SRT/VTT body field or Whisper (OpenAI key
   * in Settings). `query` narrows to moments matching a natural-language
   * request, e.g. "find the funny moments" (best-effort keyword match when
   * no AI provider is configured — see autoClip.ts).
   */
  router.post(
    '/auto',
    validateBody(autoClipSchema),
    asyncHandler(async (req, res) => {
      const b = req.body as z.infer<typeof autoClipSchema>;
      const result = await service.autoClip(b);
      res.json(result);
    }),
  );

  return router;
}
