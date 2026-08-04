import express, { type Router } from 'express';
import { z } from 'zod';
import { PLATFORMS } from '@mas/types';
import { asyncHandler, validateBody } from '../server/middleware';
import type { CapCutPackageService } from './capcutPackageService';

const captionVariantSchema = z.object({
  platform: z.enum(PLATFORMS),
  body: z.string(),
  hashtags: z.array(z.string()).default([]),
});

const createPackageSchema = z.object({
  campaignId: z.string().min(1),
  campaignTitle: z.string().min(1),
  platforms: z.array(z.enum(PLATFORMS)).min(1),
  hook: z.string().min(1),
  script: z.string().min(1),
  captionVariants: z.array(captionVariantSchema).default([]),
  trendKeywords: z.array(z.string()).default([]),
  strategyNotes: z.array(z.string()).default([]),
});

export function createCapCutRouter(service: CapCutPackageService): Router {
  const router = express.Router();

  router.post(
    '/packages',
    validateBody(createPackageSchema),
    asyncHandler(async (req, res) => {
      const result = service.createPackage(
        req.body as z.infer<typeof createPackageSchema>,
      );
      res.json(result);
    }),
  );

  return router;
}
