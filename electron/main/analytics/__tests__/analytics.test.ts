import { describe, it, expect, beforeEach } from 'vitest';
import type { Platform } from '@mas/types';
import {
  AnalyticsService,
  type AnalyticsSnapshotRecord,
  type SnapshotStore,
} from '../analyticsService';
import type {
  AccountStore,
  EngineAccount,
  QueueRunner,
} from '../../publishEngine/ports';
import type { PlatformAdapter } from '../../adapters/types';

class FakeAccounts implements AccountStore {
  map = new Map<string, EngineAccount>();
  async getById(id: string) {
    return this.map.get(id) ?? null;
  }
}

class FakeSnapshots implements SnapshotStore {
  rows: AnalyticsSnapshotRecord[] = [];
  private seq = 0;
  async create(input: any): Promise<AnalyticsSnapshotRecord> {
    const rec = { id: `snap${++this.seq}`, capturedAt: new Date(), ...input };
    this.rows.push(rec);
    return rec;
  }
  async listByAccount(accountId: string) {
    return this.rows.filter((r) => r.accountId === accountId);
  }
  async listByPost(externalPostId: string) {
    return this.rows.filter((r) => r.externalPostId === externalPostId);
  }
}

const queue: QueueRunner = { run: (_p, t) => t() };

function adapterReturning(metrics: any, behavior: 'ok' | 'throw' = 'ok') {
  return (platform: Platform): PlatformAdapter => ({
    platform,
    publish: async () => ({ externalPostId: 'x' }),
    fetchMetrics: async () => {
      if (behavior === 'throw') throw new Error('metrics failed');
      return metrics;
    },
    fetchComments: async () => [],
    replyToComment: async () => ({ externalCommentId: 'x' }),
  });
}

let accounts: FakeAccounts;
let snapshots: FakeSnapshots;

beforeEach(() => {
  accounts = new FakeAccounts();
  snapshots = new FakeSnapshots();
  accounts.map.set('a1', {
    id: 'a1',
    platform: 'facebook',
    externalId: 'PAGE1',
    credentialRef: 'r',
  });
});

describe('AnalyticsService', () => {
  it('captures and persists a normalized snapshot', async () => {
    const svc = new AnalyticsService({
      accounts,
      snapshots,
      resolveToken: async () => 'tok',
      resolveAdapter: adapterReturning({
        reach: 80,
        impressions: 100,
        engagements: 12,
        clicks: 5,
      }),
      queue,
    });
    const snap = await svc.captureSnapshot('a1', 'POST1');
    expect(snap).toMatchObject({
      accountId: 'a1',
      platform: 'facebook',
      externalPostId: 'POST1',
      reach: 80,
      impressions: 100,
    });
    expect(snapshots.rows).toHaveLength(1);
  });

  it('throws for unknown accounts', async () => {
    const svc = new AnalyticsService({
      accounts,
      snapshots,
      resolveToken: async () => 'tok',
      resolveAdapter: adapterReturning({
        reach: 0,
        impressions: 0,
        engagements: 0,
        clicks: 0,
      }),
      queue,
    });
    await expect(svc.captureSnapshot('ghost', 'P')).rejects.toThrow(
      /account_not_found/,
    );
  });

  it('captureMany isolates per-post failures', async () => {
    const svc = new AnalyticsService({
      accounts,
      snapshots,
      resolveToken: async () => 'tok',
      resolveAdapter: adapterReturning(
        { reach: 1, impressions: 1, engagements: 1, clicks: 1 },
        'throw',
      ),
      queue,
    });
    const results = await svc.captureMany([
      { accountId: 'a1', externalPostId: 'P1' },
      { accountId: 'ghost', externalPostId: 'P2' },
    ]);
    expect(results.every((r) => !r.ok)).toBe(true);
    expect(results[0].error).toBe('metrics failed');
    expect(results[1].error).toMatch(/account_not_found/);
  });

  it('lists snapshots by account and post', async () => {
    const svc = new AnalyticsService({
      accounts,
      snapshots,
      resolveToken: async () => 'tok',
      resolveAdapter: adapterReturning({
        reach: 1,
        impressions: 2,
        engagements: 3,
        clicks: 4,
      }),
      queue,
    });
    await svc.captureSnapshot('a1', 'P1');
    await svc.captureSnapshot('a1', 'P2');
    expect(await svc.getByAccount('a1')).toHaveLength(2);
    expect(await svc.getByPost('P1')).toHaveLength(1);
  });
});
