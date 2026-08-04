import express, { type Router } from 'express';
import { z } from 'zod';
import { PLATFORMS } from '@mas/types';
import { asyncHandler, validateBody } from '../server/middleware';
import type { SocialEngineWorkflowService } from './workflowService';

const campaignSchema = z.object({
  campaignTitle: z.string().min(1),
  objective: z.string().min(1),
  niche: z.string().min(1),
  platforms: z.array(z.enum(PLATFORMS)).min(1),
  approvalMode: z
    .enum(['dale_required', 'omobono_only', 'autopublish_allowed'])
    .optional(),
  tone: z.string().optional(),
});

const statusSchema = z.object({
  status: z.enum([
    'needs_approval',
    'approved',
    'scheduled',
    'published',
    'rejected',
  ]),
});

const publicationFeedbackSchema = z.object({
  platform: z.enum(PLATFORMS),
  externalPostId: z.string().min(1),
  accountId: z.string().optional(),
  publishedAt: z.string().datetime().optional(),
  notes: z.string().optional(),
});

const listStatusSchema = z.enum([
  'needs_approval',
  'approved',
  'scheduled',
  'published',
  'rejected',
]);

export function createWorkflowRouter(
  service: SocialEngineWorkflowService,
): Router {
  const router = express.Router();

  router.post(
    '/campaign-package',
    validateBody(campaignSchema),
    asyncHandler(async (req, res) => {
      const result = await service.createCampaignPackage(
        req.body as z.infer<typeof campaignSchema>,
      );
      res.json(result);
    }),
  );

  router.get(
    '/campaign-packages',
    asyncHandler(async (req, res) => {
      const parsedStatus = req.query.status
        ? listStatusSchema.safeParse(req.query.status)
        : null;
      if (parsedStatus && !parsedStatus.success) {
        res.status(400).json({ error: 'invalid_status' });
        return;
      }
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const packages = await service.listCampaignPackages({
        status: parsedStatus?.success ? parsedStatus.data : undefined,
        limit: Number.isFinite(limit) ? limit : undefined,
      });
      res.json({ packages });
    }),
  );

  router.get(
    '/campaign-packages/:id',
    asyncHandler(async (req, res) => {
      const packageId = String(req.params.id);
      const pkg = await service.getCampaignPackage(packageId);
      if (!pkg) {
        res.status(404).json({ error: 'campaign_package_not_found' });
        return;
      }
      res.json(pkg);
    }),
  );

  router.patch(
    '/campaign-packages/:id/status',
    validateBody(statusSchema),
    asyncHandler(async (req, res) => {
      const packageId = String(req.params.id);
      const result = await service.updateCampaignPackageStatus(
        packageId,
        req.body.status,
      );
      res.json(result);
    }),
  );

  router.post(
    '/campaign-packages/:id/publication-feedback',
    validateBody(publicationFeedbackSchema),
    asyncHandler(async (req, res) => {
      const packageId = String(req.params.id);
      const feedback = {
        ...req.body,
        publishedAt: req.body.publishedAt ?? new Date().toISOString(),
        analyticsStatus: 'pending_capture' as const,
      };
      const result = await service.recordPublicationFeedback(
        packageId,
        feedback,
      );
      res.json(result);
    }),
  );

  return router;
}
