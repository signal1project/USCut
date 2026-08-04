import express, { type Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { asyncHandler, validateBody } from '../server/middleware';
import type { InsightsService } from './insightsService';
import type { Settings, CompetitorEntry } from '../settings/settings';
import { buildBioPageHtml } from './bioPage';

const recycleSchema = z.object({
  count: z.number().int().min(1).max(10).default(3),
  spacingHours: z.number().int().min(1).max(168).default(24),
});

const competitorSchema = z.object({
  name: z.string().min(1),
  platform: z.string().min(1),
  handle: z.string().min(1),
  notes: z.string().default(''),
});

const competitorSnapshotSchema = z.object({
  followers: z.number().int().nonnegative(),
  engagementRate: z.number().nonnegative().optional(),
});

const bioPageSchema = z.object({
  name: z.string().min(1),
  tagline: z.string().optional(),
  brokerage: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  accentColor: z.string().optional(),
  links: z
    .array(z.object({ label: z.string().min(1), url: z.string().min(1) }))
    .default([]),
  listings: z
    .array(
      z.object({
        address: z.string().min(1),
        price: z.string().optional(),
        specs: z.string().optional(),
        url: z.string().optional(),
        photoUrl: z.string().optional(),
      }),
    )
    .optional(),
});

export interface InsightsRouterDeps {
  service: InsightsService;
  settings: Settings;
  /** Directory to write generated bio pages into (userData in prod). */
  outputDir: string;
}

export function createInsightsRouter(deps: InsightsRouterDeps): Router {
  const router = express.Router();
  const { service, settings } = deps;

  // ── Calendar feed ───────────────────────────────────────────────────────────
  router.get(
    '/calendar',
    asyncHandler(async (req, res) => {
      const { from, to } = req.query as Record<string, string | undefined>;
      res.json({ entries: await service.listScheduled(from, to) });
    }),
  );

  // ── Best time to post ───────────────────────────────────────────────────────
  router.get(
    '/best-times',
    asyncHandler(async (req, res) => {
      const platform = (req.query.platform as string | undefined) || undefined;
      res.json(await service.bestTimes(platform));
    }),
  );

  // ── Evergreen recycling ─────────────────────────────────────────────────────
  router.post(
    '/recycle',
    validateBody(recycleSchema),
    asyncHandler(async (req, res) => {
      const b = req.body as z.infer<typeof recycleSchema>;
      res.json(await service.recycleTop(b.count, b.spacingHours));
    }),
  );

  // ── Competitor tracking ─────────────────────────────────────────────────────
  router.get('/competitors', (_req, res) => {
    res.json({ competitors: settings.getCompetitors() });
  });

  router.post(
    '/competitors',
    validateBody(competitorSchema),
    asyncHandler(async (req, res) => {
      const b = req.body as z.infer<typeof competitorSchema>;
      const entry: CompetitorEntry = {
        id: crypto.randomUUID(),
        ...b,
        snapshots: [],
      };
      settings.setCompetitors([...settings.getCompetitors(), entry]);
      res.status(201).json({ competitor: entry });
    }),
  );

  router.post(
    '/competitors/:id/snapshot',
    validateBody(competitorSnapshotSchema),
    asyncHandler(async (req, res) => {
      const b = req.body as z.infer<typeof competitorSnapshotSchema>;
      const all = settings.getCompetitors();
      const entry = all.find((c) => c.id === req.params.id);
      if (!entry) {
        res.status(404).json({ error: 'competitor_not_found' });
        return;
      }
      entry.snapshots.push({ date: new Date().toISOString(), ...b });
      settings.setCompetitors(all);
      res.json({ competitor: entry });
    }),
  );

  router.delete('/competitors/:id', (req, res) => {
    const all = settings.getCompetitors();
    const next = all.filter((c) => c.id !== req.params.id);
    if (next.length === all.length) {
      res.status(404).json({ error: 'competitor_not_found' });
      return;
    }
    settings.setCompetitors(next);
    res.json({ ok: true });
  });

  // ── Bio page generator ──────────────────────────────────────────────────────
  router.post(
    '/bio-page',
    validateBody(bioPageSchema),
    asyncHandler(async (req, res) => {
      const b = req.body as z.infer<typeof bioPageSchema>;
      const html = buildBioPageHtml(b);
      fs.mkdirSync(deps.outputDir, { recursive: true });
      const outPath = path.join(deps.outputDir, 'bio-page.html');
      fs.writeFileSync(outPath, html, 'utf8');
      res.json({ path: outPath, bytes: Buffer.byteLength(html) });
    }),
  );

  return router;
}
