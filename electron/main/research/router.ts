import { Router } from 'express';
import { z } from 'zod';
import type { TrendingResearchService } from './trendingService';
import { scrapeContentIdeas } from './contentScraper';

const querySchema = z.object({
  niche: z.string().optional(),
  sources: z.string().optional(), // comma-separated
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export function createResearchRouter(
  research: TrendingResearchService,
): Router {
  const router = Router();

  /**
   * GET /api/research/trending
   * Query params:
   *   niche    - e.g. "real estate" (URL-encoded)
   *   sources  - comma-separated source names to filter; omit for all
   *   limit    - max results 1–50 (default 20)
   *
   * Returns { signals: TrendSignal[], cachedUntil: ISO, sources: string[] }
   */
  router.get('/trending', async (req, res, next) => {
    try {
      const q = querySchema.parse(req.query);
      const result = await research.getTrending({
        niche: q.niche,
        sources: q.sources
          ?.split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        limit: q.limit,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/research/scrape?keyword=...
   * Fetches Google News RSS for the keyword and returns content ideas.
   */
  router.get('/scrape', async (req, res, next) => {
    try {
      const keyword = String(req.query.keyword ?? '').trim();
      if (!keyword) {
        res.status(400).json({ error: 'keyword required' });
        return;
      }
      const ideas = await scrapeContentIdeas(keyword);
      res.json({ keyword, ideas });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
