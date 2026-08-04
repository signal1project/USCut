import { Router } from 'express';
import { z } from 'zod';
import { PLATFORMS } from '@mas/types';
import type { PlatformAlgorithmAgent } from './algorithmAgent';

const querySchema = z.object({
  platform: z.enum(PLATFORMS).optional(),
  platforms: z.string().optional(), // comma-separated list
});

export function createAlgorithmRouter(agent: PlatformAlgorithmAgent): Router {
  const router = Router();

  /**
   * GET /api/algorithm/hints?platform=instagram
   * GET /api/algorithm/hints?platforms=instagram,twitter,facebook
   *
   * Returns AlgorithmHints (single) or AlgorithmHints[] (multi).
   */
  router.get('/hints', (req, res, next) => {
    try {
      const q = querySchema.parse(req.query);

      if (q.platforms) {
        const names = q.platforms
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        // Validate each platform name.
        const parsed = z.array(z.enum(PLATFORMS)).safeParse(names);
        if (!parsed.success) {
          res.status(400).json({
            error: 'Invalid platform in list',
            details: parsed.error.errors,
          });
          return;
        }
        res.json(agent.getHintsForPlatforms(parsed.data));
        return;
      }

      if (q.platform) {
        res.json(agent.getHints(q.platform));
        return;
      }

      // No filter — return hints for all platforms.
      res.json(agent.getHintsForPlatforms([...PLATFORMS]));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
