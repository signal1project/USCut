import { Router } from 'express';
import { z } from 'zod';
import { PLATFORMS } from '@mas/types';
import type { ListingStore } from './listingStore';
import type { ListingAdService } from './adService';
import type { ListingVideoService } from './videoService';
import { captureFromUrl } from './urlCapture';

const capturePayloadSchema = z.object({
  source: z.enum(['zillow', 'realtor', 'redfin', 'manual']),
  mlsNumber: z.string().optional(),
  address: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1),
  zip: z.string().optional(),
  price: z.number().int().nonnegative().optional(),
  beds: z.number().nonnegative().optional(),
  baths: z.number().nonnegative().optional(),
  sqft: z.number().int().nonnegative().optional(),
  lotSqft: z.number().int().nonnegative().optional(),
  yearBuilt: z.number().int().optional(),
  propertyType: z.string().optional(),
  status: z.string().optional(),
  daysOnMarket: z.number().int().nonnegative().optional(),
  description: z.string().optional(),
  photoUrls: z.array(z.string()).max(20).optional(),
  agentName: z.string().optional(),
  agentPhone: z.string().optional(),
  agentEmail: z.string().optional(),
  listingUrl: z.string().optional(),
});

const generateAdSchema = z.object({
  platforms: z.array(z.enum(PLATFORMS)).min(1),
  tone: z.string().optional(),
  highlight: z.string().max(300).optional(),
});

const captureUrlSchema = z.object({
  url: z.string().url(),
});

const generateVideoSchema = z.object({
  maxPhotos: z.number().int().min(1).max(8).optional(),
  secondsPerPhoto: z.number().min(2).max(6).optional(),
  narration: z.boolean().optional(),
});

const listQuerySchema = z.object({
  source: z.string().optional(),
  state: z.string().optional(),
  city: z.string().optional(),
  status: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

/**
 * Listing Scraper routes (mounted under the authed /api as /api/listings):
 *
 *   POST   /api/listings/capture          — save a captured listing (dedupe by listingUrl)
 *   GET    /api/listings                  — list with source/state/city/status filters
 *   GET    /api/listings/:id              — single listing detail
 *   DELETE /api/listings/:id              — remove a listing
 *   POST   /api/listings/:id/generate-ad  — AI listing ad per platform (authed API only)
 *
 * The Chrome extension reaches `capture` through the fixed-port capture
 * server (see captureServer.ts) since it cannot obtain the rotating bearer
 * token; the UI and MCP agents use these authed routes. The capture server
 * builds this router WITHOUT adService so ad generation (which spends AI
 * credits) is never exposed unauthenticated.
 */
export function createListingsRouter(
  store: ListingStore,
  opts: {
    adService?: ListingAdService;
    videoService?: ListingVideoService;
  } = {},
): Router {
  const router = Router();

  router.post('/capture', async (req, res, next) => {
    try {
      const payload = capturePayloadSchema.parse(req.body);
      const listing = await store.capture(payload);
      res.status(201).json({ listing });
    } catch (err) {
      next(err);
    }
  });

  router.get('/', async (req, res, next) => {
    try {
      const q = listQuerySchema.parse(req.query);
      const result = await store.list(q);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const listing = await store.get(req.params.id);
      if (!listing) {
        res.status(404).json({ error: 'listing_not_found' });
        return;
      }
      res.json({ listing });
    } catch (err) {
      next(err);
    }
  });

  // Paste-a-URL capture — parses schema.org JSON-LD / OpenGraph server-side.
  router.post('/capture-url', async (req, res, next) => {
    try {
      const { url } = captureUrlSchema.parse(req.body);
      const payload = await captureFromUrl(url);
      if (!payload) {
        res.status(422).json({
          error: 'listing_not_extractable',
          hint: 'This page does not expose structured listing data — use the Chrome extension instead.',
        });
        return;
      }
      const listing = await store.capture(payload);
      res.status(201).json({ listing });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/generate-video', async (req, res, next) => {
    try {
      if (!opts.videoService) {
        res.status(503).json({ error: 'video_generation_unavailable' });
        return;
      }
      const body = generateVideoSchema.parse(req.body ?? {});
      const result = await opts.videoService.generateVideo(req.params.id, body);
      if (!result) {
        res.status(404).json({ error: 'listing_not_found' });
        return;
      }
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/generate-ad', async (req, res, next) => {
    try {
      if (!opts.adService) {
        res.status(503).json({ error: 'ad_generation_unavailable' });
        return;
      }
      const body = generateAdSchema.parse(req.body);
      const result = await opts.adService.generateAd(req.params.id, body);
      if (!result) {
        res.status(404).json({ error: 'listing_not_found' });
        return;
      }
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      const removed = await store.remove(req.params.id);
      if (!removed) {
        res.status(404).json({ error: 'listing_not_found' });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
