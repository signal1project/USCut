import express, { type Express, type Router } from 'express';
import { bearerAuth, errorHandler } from './middleware';

export interface FeatureRoute {
  path: string;
  router: Router;
}

export interface ApiAppOptions {
  apiToken: string;
  /** Feature routers (publish, content, analytics, engagement) mounted under /api. */
  routes?: FeatureRoute[];
}

/**
 * Build the embedded API Express app. Everything under /api requires the bearer
 * token; /health is open for liveness checks. Feature routers are injected so
 * the publish/content/analytics/engagement services (Tasks 12–15) plug in
 * without this module depending on them.
 */
export function createApiApp(options: ApiAppOptions): Express {
  const app = express();

  // The renderer calls this API with an Authorization header, which forces
  // the browser to send a CORS preflight (OPTIONS) before every request —
  // even a plain GET. This is a loopback-only API trusted by its rotating
  // bearer token, not by origin, so allow any origin; the important part is
  // answering OPTIONS with 2xx *before* bearerAuth, which would otherwise
  // 401 every preflight (browsers never send Authorization on preflight).
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'authorization,content-type');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use(express.json({ limit: '10mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'master-ai-social' });
  });

  const api = express.Router();
  api.use(bearerAuth(options.apiToken));
  for (const route of options.routes ?? []) {
    api.use(route.path, route.router);
  }
  app.use('/api', api);

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });
  app.use(errorHandler);

  return app;
}
