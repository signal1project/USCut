import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PubStatus, PubType, type Platform } from '@mas/types';
import { PublishEngine } from '../publishEngine';
import { createPublishRouter } from '../router';
import {
  Scheduler,
  type SchedulerBackend,
  type CancellableJob,
} from '../../scheduling/scheduler';
import { startApiServer, type RunningApiServer } from '../../server';
import type { PlatformAdapter } from '../../adapters/types';
import type {
  AccountStore,
  AuditStore,
  EngineAccount,
  PublishHistoryStore,
  ScheduledPostStore,
  QueueRunner,
} from '../ports';

// Minimal in-memory deps reused from the engine test shape.
function buildEngine() {
  const accounts: AccountStore = {
    async getById(id) {
      const m: Record<string, EngineAccount> = {
        a1: {
          id: 'a1',
          platform: 'facebook',
          externalId: 'PAGE1',
          credentialRef: 'r1',
        },
      };
      return m[id] ?? null;
    },
  };
  let seq = 0;
  const historyRows: any[] = [];
  const history: PublishHistoryStore = {
    async create(input) {
      const rec = {
        id: `h${++seq}`,
        externalPostId: '',
        error: '',
        publishedAt: null,
        ...input,
      } as any;
      historyRows.push(rec);
      return rec;
    },
    async update(id, patch) {
      Object.assign(historyRows.find((r) => r.id === id), patch);
    },
    async list(filter) {
      let rows = historyRows;
      if (filter?.platform) rows = rows.filter((r) => r.platform === filter.platform);
      if (filter?.status) rows = rows.filter((r) => r.status === filter.status);
      return rows.slice(0, filter?.limit ?? 25);
    },
  };
  const scheduledRows = new Map<string, any>();
  const scheduled: ScheduledPostStore = {
    async create(input) {
      const rec = { id: `s${++seq}`, ...input } as any;
      scheduledRows.set(rec.id, rec);
      return rec;
    },
    async update(id, patch) {
      Object.assign(scheduledRows.get(id), patch);
    },
    async list(platform) {
      const rows = [...scheduledRows.values()];
      return platform ? rows.filter((r) => r.platform === platform) : rows;
    },
    async remove(id) {
      return scheduledRows.delete(id);
    },
  };
  const audit: AuditStore = { async record() {} };
  const queue: QueueRunner = { run: (_p, t) => t() };
  const adapter = (platform: Platform): PlatformAdapter => ({
    platform,
    publish: async () => ({ externalPostId: 'POST1' }),
    fetchMetrics: async () => ({
      reach: 0,
      impressions: 0,
      engagements: 0,
      clicks: 0,
    }),
    fetchComments: async () => [],
    replyToComment: async () => ({ externalCommentId: 'x' }),
  });
  return new PublishEngine({
    accounts,
    history,
    scheduled,
    audit,
    resolveToken: async () => 'tok',
    resolveAdapter: adapter,
    queue,
  });
}

// Fake scheduler backend that accepts future jobs without firing.
const fakeBackend: SchedulerBackend = {
  schedule(): CancellableJob {
    return { cancel() {} };
  },
};

let api: RunningApiServer;

beforeAll(async () => {
  const engine = buildEngine();
  const scheduler = new Scheduler(fakeBackend);
  const router = createPublishRouter(engine, scheduler);
  api = await startApiServer({
    token: 'T',
    routes: [{ path: '/publish', router }],
  });
});
afterAll(async () => {
  await api.close();
});

const headers = {
  Authorization: 'Bearer T',
  'Content-Type': 'application/json',
};

describe('POST /api/publish', () => {
  it('publishes immediately and returns the outcome', async () => {
    const res = await fetch(`${api.url}/api/publish`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        accountIds: ['a1'],
        pubType: PubType.IMAGE_TEXT,
        body: 'hi',
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe(PubStatus.PUBLISHED);
    expect(json.results[0].externalPostId).toBe('POST1');
  });

  it('schedules when runAt is in the future (202)', async () => {
    const runAt = new Date(Date.now() + 3_600_000).toISOString();
    const res = await fetch(`${api.url}/api/publish`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        accountIds: ['a1'],
        pubType: PubType.IMAGE_TEXT,
        body: 'later',
        contentAssetId: 'asset-1',
        runAt,
      }),
    });
    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json.scheduled).toBe(true);
    expect(json.scheduledPostIds.length).toBe(1);
  });

  it('rejects scheduling without a contentAssetId (400)', async () => {
    const runAt = new Date(Date.now() + 3_600_000).toISOString();
    const res = await fetch(`${api.url}/api/publish`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        accountIds: ['a1'],
        pubType: PubType.IMAGE_TEXT,
        body: 'x',
        runAt,
      }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects an empty accountIds list (validation 400)', async () => {
    const res = await fetch(`${api.url}/api/publish`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        accountIds: [],
        pubType: PubType.IMAGE_TEXT,
        body: 'x',
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/publish/scheduled and DELETE /api/publish/scheduled/:id', () => {
  it('lists a post scheduled via POST /api/publish and cancels it', async () => {
    const runAt = new Date(Date.now() + 3_600_000).toISOString();
    const scheduleRes = await fetch(`${api.url}/api/publish`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        accountIds: ['a1'],
        pubType: PubType.IMAGE_TEXT,
        body: 'scheduled post',
        contentAssetId: 'asset-list-1',
        runAt,
      }),
    });
    const { scheduledPostIds } = await scheduleRes.json();
    const id = scheduledPostIds[0];

    const listRes = await fetch(`${api.url}/api/publish/scheduled`, { headers });
    expect(listRes.status).toBe(200);
    const { scheduled } = await listRes.json();
    expect(scheduled.some((s: any) => s.id === id)).toBe(true);

    const cancelRes = await fetch(`${api.url}/api/publish/scheduled/${id}`, {
      method: 'DELETE',
      headers,
    });
    expect(cancelRes.status).toBe(200);

    const afterRes = await fetch(`${api.url}/api/publish/scheduled`, { headers });
    const { scheduled: afterCancel } = await afterRes.json();
    expect(afterCancel.some((s: any) => s.id === id)).toBe(false);
  });

  it('404s cancelling an unknown scheduled post', async () => {
    const res = await fetch(`${api.url}/api/publish/scheduled/nope`, {
      method: 'DELETE',
      headers,
    });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/publish/history', () => {
  it('returns publish history after a publish', async () => {
    await fetch(`${api.url}/api/publish`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        accountIds: ['a1'],
        pubType: PubType.IMAGE_TEXT,
        body: 'history check',
      }),
    });
    const res = await fetch(`${api.url}/api/publish/history`, { headers });
    expect(res.status).toBe(200);
    const { history } = await res.json();
    expect(history.length).toBeGreaterThan(0);
    expect(history[0].platform).toBe('facebook');

    const filtered = await fetch(
      `${api.url}/api/publish/history?platform=twitter`,
      { headers },
    );
    const { history: twitterOnly } = await filtered.json();
    expect(twitterOnly.every((h: any) => h.platform === 'twitter')).toBe(true);
  });
});
