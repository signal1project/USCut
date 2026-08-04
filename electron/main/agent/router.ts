import express, { type Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../server/middleware';
import type { AgentAdapterRegistry } from './registry';

const taskSchema = z.object({
  adapterId: z.string().optional(),
  taskType: z.enum([
    'trend_brief',
    'platform_playbook',
    'content_concept',
    'capcut_package',
    'campaign_strategy',
    'publishing_plan',
    'performance_review',
  ]),
  objective: z.string().min(1),
  context: z.record(z.unknown()).optional(),
  constraints: z.array(z.string()).optional(),
});

export function createAgentRouter(registry: AgentAdapterRegistry): Router {
  const router = express.Router();

  router.get('/adapters', (_req, res) => {
    res.json({
      defaultAdapterId: registry.getDefault().id,
      adapters: registry
        .list()
        .map((a) => ({ id: a.id, label: a.label, kind: a.kind })),
    });
  });

  router.post(
    '/task',
    validateBody(taskSchema),
    asyncHandler(async (req, res) => {
      const b = req.body as z.infer<typeof taskSchema>;
      const adapter = b.adapterId
        ? registry.get(b.adapterId)
        : registry.getDefault();
      const result = await adapter.runTask({
        taskType: b.taskType,
        objective: b.objective,
        context: b.context,
        constraints: b.constraints,
      });
      res.json(result);
    }),
  );

  return router;
}
