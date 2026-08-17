import express, { type Router } from 'express';
import { z } from 'zod';
import { PubType, PLATFORMS, type PubStatus } from '@mas/types';
import { asyncHandler, validateBody } from '../server/middleware';
import type { Scheduler } from '../scheduling/scheduler';
import type { PublishEngine } from './publishEngine';

const scheduledQuerySchema = z.object({
  platform: z.enum(PLATFORMS).optional(),
});

const historyQuerySchema = z.object({
  platform: z.enum(PLATFORMS).optional(),
  status: z.enum(['draft', 'queued', 'publishing', 'published', 'failed', 'part-success']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const publishBodySchema = z.object({
  accountIds: z.array(z.string().min(1)).min(1),
  pubType: z.nativeEnum(PubType),
  body: z.string().max(63206).default(''),
  hashtags: z.array(z.string()).default([]),
  // Pre-resolved, publicly fetchable media URLs.
  mediaRefs: z.array(z.string()).default([]),
  contentAssetId: z.string().nullable().default(null),
  /** When set (future), the post is scheduled instead of published immediately. */
  runAt: z.coerce.date().optional(),
});

export function createPublishRouter(
  engine: PublishEngine,
  scheduler: Scheduler,
  /**
   * When provided, timers fire through this (publishes AND updates the
   * scheduled row's status — see mas/scheduledFiring.ts). Falls back to a
   * bare publishNow for tests that don't wire persistence.
   */
  fireScheduled?: (postId: string) => Promise<unknown>,
  /**
   * Creates a content asset for schedule requests that arrive without one
   * (Scheduler page, Share dialog) so the post can be reconstructed after an
   * app restart.
   */
  persistAsset?: (
    accountIds: string[],
    content: {
      pubType: PubType;
      body: string;
      hashtags: string[];
      mediaUrls: string[];
    },
  ) => Promise<string>,
): Router {
  const router = express.Router();

  router.post(
    '/',
    validateBody(publishBodySchema),
    asyncHandler(async (req, res) => {
      const b = req.body as z.infer<typeof publishBodySchema>;
      const content = {
        pubType: b.pubType,
        body: b.body,
        hashtags: b.hashtags,
        mediaUrls: b.mediaRefs,
        contentAssetId: b.contentAssetId,
      };

      if (b.runAt && b.runAt.getTime() > Date.now()) {
        let assetId = b.contentAssetId;
        if (!assetId && persistAsset) {
          assetId = await persistAsset(b.accountIds, {
            pubType: b.pubType,
            body: b.body,
            hashtags: b.hashtags,
            mediaUrls: b.mediaRefs,
          });
        }
        if (!assetId) {
          res
            .status(400)
            .json({ error: 'content_asset_required_for_schedule' });
          return;
        }
        const outcome = await engine.schedule(
          b.accountIds,
          { ...content, contentAssetId: assetId },
          b.runAt,
        );
        for (const id of outcome.scheduledPostIds) {
          scheduler.schedule(id, b.runAt, () => {
            if (fireScheduled) void fireScheduled(id);
            else void engine.publishNow(b.accountIds, content);
          });
        }
        res.status(202).json({
          scheduled: true,
          scheduledPostIds: outcome.scheduledPostIds,
        });
        return;
      }

      const outcome = await engine.publishNow(b.accountIds, content);
      res.json(outcome);
    }),
  );

  router.get(
    '/scheduled',
    asyncHandler(async (req, res) => {
      const { platform } = scheduledQuerySchema.parse(req.query);
      const scheduled = await engine.listScheduled(platform);
      res.json({ scheduled });
    }),
  );

  router.get(
    '/history',
    asyncHandler(async (req, res) => {
      const q = historyQuerySchema.parse(req.query);
      const history = await engine.listHistory({
        platform: q.platform,
        status: q.status as PubStatus | undefined,
        limit: q.limit,
      });
      res.json({ history });
    }),
  );

  router.delete(
    '/scheduled/:id',
    asyncHandler(async (req, res) => {
      const id = String(req.params.id);
      const removed = await engine.cancelScheduled(id);
      if (!removed) {
        res.status(404).json({ error: 'scheduled_post_not_found' });
        return;
      }
      scheduler.cancel(id);
      res.json({ ok: true });
    }),
  );

  return router;
}
