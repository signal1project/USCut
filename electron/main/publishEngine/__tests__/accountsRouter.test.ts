import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { DataSource } from 'typeorm';
import { AccountStatus } from '@mas/types';
import { ConnectedAccountModel } from '../../../db/models/mas/connectedAccount';
import { createAccountsRouter } from '../accountsRouter';
import { startApiServer, type RunningApiServer } from '../../server';

// better-sqlite3 is rebuilt against Electron's ABI — skip under plain node,
// same pattern as listingStore.test.ts / masSchema.test.ts.
const nativeLoads = (() => {
  try {
    const Database = createRequire(import.meta.url)('better-sqlite3');
    new Database(':memory:').close();
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!nativeLoads)('GET /api/accounts', () => {
  let ds: DataSource;
  let api: RunningApiServer;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      synchronize: true,
      entities: [ConnectedAccountModel],
    });
    await ds.initialize();
    const repo = ds.getRepository(ConnectedAccountModel);
    await repo.save(
      repo.create({
        platform: 'facebook',
        accountName: 'Test Realty',
        externalId: 'PAGE1',
        status: AccountStatus.CONNECTED,
        metadata: { brandId: 'brand-1' },
      }),
    );
    await repo.save(
      repo.create({
        platform: 'instagram',
        accountName: 'Test Realty IG',
        externalId: 'IGUSER1',
        status: AccountStatus.EXPIRED,
        metadata: { source: 'webview' },
      }),
    );

    api = await startApiServer({
      token: 'accounts-test-token',
      routes: [{ path: '/accounts', router: createAccountsRouter(ds) }],
    });
  });

  afterAll(async () => {
    await api.close();
    if (ds?.isInitialized) await ds.destroy();
  });

  it('returns connected accounts with platform, status, and derived brand/source', async () => {
    const res = await fetch(`${api.url}/api/accounts`, {
      headers: { Authorization: 'Bearer accounts-test-token' },
    });
    expect(res.status).toBe(200);
    const { accounts } = await res.json();
    expect(accounts).toHaveLength(2);

    const fb = accounts.find((a: any) => a.platform === 'facebook');
    expect(fb.status).toBe(AccountStatus.CONNECTED);
    expect(fb.brandId).toBe('brand-1');
    expect(fb.source).toBe('oauth'); // default when metadata.source is absent

    const ig = accounts.find((a: any) => a.platform === 'instagram');
    expect(ig.status).toBe(AccountStatus.EXPIRED);
    expect(ig.source).toBe('webview');
  });

  it('requires the bearer token', async () => {
    const res = await fetch(`${api.url}/api/accounts`);
    expect(res.status).toBe(401);
  });
});
