import express, { type Router } from 'express';
import { z } from 'zod';
import { PLATFORMS } from '@mas/types';
import { asyncHandler, validateBody } from '../server/middleware';
import type { ContentService } from './contentService';

const generateSchema = z.object({
  brief: z.string().min(1),
  platforms: z.array(z.enum(PLATFORMS)).min(1),
  tone: z.string().optional(),
  variants: z.number().int().min(1).max(3).optional(),
});

const carouselSchema = z.object({
  brief: z.string().min(1),
  platform: z.enum(PLATFORMS),
  slideCount: z.number().int().min(3).max(10).optional(),
  tone: z.string().optional(),
});

const imageSchema = z.object({
  prompt: z.string().min(1),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

export function createContentRouter(service: ContentService): Router {
  const router = express.Router();

  router.post(
    '/generate',
    validateBody(generateSchema),
    asyncHandler(async (req, res) => {
      const b = req.body as z.infer<typeof generateSchema>;
      const result = await service.generate(b);
      res.json(result);
    }),
  );

  router.post(
    '/carousel',
    validateBody(carouselSchema),
    asyncHandler(async (req, res) => {
      const b = req.body as z.infer<typeof carouselSchema>;
      const result = await service.generateCarousel(b);
      res.json(result);
    }),
  );

  router.post(
    '/image',
    validateBody(imageSchema),
    asyncHandler(async (req, res) => {
      const b = req.body as z.infer<typeof imageSchema>;
      const result = await service.generateImage(b.prompt, {
        width: b.width,
        height: b.height,
      });
      res.json(result);
    }),
  );

  return router;
}
