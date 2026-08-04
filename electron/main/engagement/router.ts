import express, { type Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../server/middleware';
import type { EngagementService } from './engagementService';

const ingestSchema = z.object({
  accountId: z.string().min(1),
  externalPostId: z.string().min(1),
});
const draftSchema = z.object({ draftReply: z.string() });
const approveSchema = z.object({ overrideText: z.string().optional() });

export function createEngagementRouter(service: EngagementService): Router {
  const router = express.Router();

  router.post(
    '/ingest',
    validateBody(ingestSchema),
    asyncHandler(async (req, res) => {
      const b = req.body as z.infer<typeof ingestSchema>;
      res.json({
        items: await service.ingestComments(b.accountId, b.externalPostId),
      });
    }),
  );

  router.get(
    '/pending',
    asyncHandler(async (_req, res) => {
      res.json({ items: await service.listPending() });
    }),
  );

  router.patch(
    '/:id/draft',
    validateBody(draftSchema),
    asyncHandler(async (req, res) => {
      await service.updateDraft(
        String(req.params.id),
        (req.body as z.infer<typeof draftSchema>).draftReply,
      );
      res.json({ ok: true });
    }),
  );

  router.post(
    '/:id/approve',
    validateBody(approveSchema),
    asyncHandler(async (req, res) => {
      const result = await service.approveAndReply(
        String(req.params.id),
        (req.body as z.infer<typeof approveSchema>).overrideText,
      );
      res.json(result);
    }),
  );

  router.post(
    '/:id/dismiss',
    asyncHandler(async (req, res) => {
      await service.dismiss(String(req.params.id));
      res.json({ ok: true });
    }),
  );

  return router;
}
