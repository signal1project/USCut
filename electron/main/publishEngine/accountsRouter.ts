import express, { type Router } from 'express';
import type { DataSource } from 'typeorm';
import { asyncHandler } from '../server/middleware';
import { ConnectedAccountModel } from '../../db/models/mas/connectedAccount';

/**
 * GET /api/accounts — connected social accounts, for the publish/schedule UI
 * account picker and MCP agent clients (e.g. Hermes' list_accounts tool).
 * Mirrors the shape the renderer already gets via the `mas:accounts:list`
 * IPC handler (mas/ipc.ts) so both callers see the same account data.
 */
export function createAccountsRouter(dataSource: DataSource): Router {
  const router = express.Router();

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      const repo = dataSource.getRepository(ConnectedAccountModel);
      const accounts = await repo.find({
        order: { platform: 'ASC', accountName: 'ASC' },
      });
      res.json({
        accounts: accounts.map((a) => ({
          id: a.id,
          platform: a.platform,
          accountName: a.accountName,
          externalId: a.externalId,
          status: a.status,
          brandId:
            typeof a.metadata?.brandId === 'string' ? a.metadata.brandId : null,
          source:
            typeof a.metadata?.source === 'string'
              ? a.metadata.source
              : 'oauth',
        })),
      });
    }),
  );

  return router;
}
