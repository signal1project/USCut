import express, { type Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../server/middleware';
import type { AnalyticsService } from './analyticsService';

const captureSchema = z.object({
  accountId: z.string().min(1),
  externalPostId: z.string().min(1),
});

export function createAnalyticsRouter(service: AnalyticsService): Router {
  const router = express.Router();

  router.post(
    '/capture',
    validateBody(captureSchema),
    asyncHandler(async (req, res) => {
      const b = req.body as z.infer<typeof captureSchema>;
      const snapshot = await service.captureSnapshot(
        b.accountId,
        b.externalPostId,
      );
      res.json(snapshot);
    }),
  );

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const accountId = req.query.accountId;
      const postId = req.query.postId;
      if (typeof accountId === 'string') {
        res.json({ snapshots: await service.getByAccount(accountId) });
        return;
      }
      if (typeof postId === 'string') {
        res.json({ snapshots: await service.getByPost(postId) });
        return;
      }
      res.status(400).json({ error: 'accountId_or_postId_required' });
    }),
  );

  return router;
}
