import { describe, it, expect, beforeEach } from 'vitest';
import { PubStatus, PubType, type Platform } from '@mas/types';
import { PublishEngine } from '../publishEngine';
import type {
  AccountStore,
  AuditStore,
  EngineAccount,
  PublishHistoryRecord,
  PublishHistoryStore,
  ScheduledPostRecord,
  ScheduledPostStore,
  QueueRunner,
} from '../ports';
import type { PlatformAdapter } from '../../adapters/types';

class FakeAccounts implements AccountStore {
  map = new Map<string, EngineAccount>();
  add(a: EngineAccount) {
    this.map.set(a.id, a);
  }
  async getById(id: string) {
    return this.map.get(id) ?? null;
  }
}

class FakeHistory implements PublishHistoryStore {
  rows = new Map<string, PublishHistoryRecord>();
  private seq = 0;
  async create(input: any): Promise<PublishHistoryRecord> {
    const id = `h${++this.seq}`;
    const rec: PublishHistoryRecord = {
      id,
      externalPostId: '',
      error: '',
      publishedAt: null,
      ...input,
    };
    this.rows.set(id, rec);
    return rec;
  }
  async update(id: string, patch: any) {
    Object.assign(this.rows.get(id)!, patch);
  }
}

class FakeScheduled implements ScheduledPostStore {
  rows = new Map<string, ScheduledPostRecord>();
  private seq = 0;
  async create(input: any): Promise<ScheduledPostRecord> {
    const id = `s${++this.seq}`;
    const rec = { id, ...input } as ScheduledPostRecord;
    this.rows.set(id, rec);
    return rec;
  }
  async update(id: string, patch: any) {
    Object.assign(this.rows.get(id)!, patch);
  }
}

class FakeAudit implements AuditStore {
  entries: any[] = [];
  async record(action: any, entity: string, entityId: string, details: any) {
    this.entries.push({ action, entity, entityId, details });
  }
}

const immediateQueue: QueueRunner = { run: (_p, task) => task() };

function fakeAdapter(
  platform: Platform,
  behavior: 'ok' | 'throw' = 'ok',
): PlatformAdapter {
  return {
    platform,
    publish: async (ctx, input) => {
      if (behavior === 'throw') throw new Error('publish failed');
      return {
        externalPostId: `post-${platform}-${ctx.externalId}-${input.body.slice(0, 3)}`,
      };
    },
    fetchMetrics: async () => ({
      reach: 0,
      impressions: 0,
      engagements: 0,
      clicks: 0,
    }),
    fetchComments: async () => [],
    replyToComment: async () => ({ externalCommentId: 'x' }),
  };
}

const content = {
  pubType: PubType.IMAGE_TEXT,
  body: 'hello',
  hashtags: ['#a'],
  mediaUrls: [],
};

let accounts: FakeAccounts;
let history: FakeHistory;
let scheduled: FakeScheduled;
let audit: FakeAudit;

function makeEngine(
  adapterBehavior: Record<Platform, 'ok' | 'throw'> = {} as any,
) {
  return new PublishEngine({
    accounts,
    history,
    scheduled,
    audit,
    resolveToken: async (acc) => `token-${acc.id}`,
    resolveAdapter: (platform) =>
      fakeAdapter(platform, adapterBehavior[platform] ?? 'ok'),
    queue: immediateQueue,
    now: () => new Date('2026-05-22T00:00:00Z'),
  });
}

beforeEach(() => {
  accounts = new FakeAccounts();
  history = new FakeHistory();
  scheduled = new FakeScheduled();
  audit = new FakeAudit();
  accounts.add({
    id: 'a1',
    platform: 'facebook',
    externalId: 'PAGE1',
    credentialRef: 'facebook:PAGE1',
  });
  accounts.add({
    id: 'a2',
    platform: 'twitter',
    externalId: 'me',
    credentialRef: 'twitter:me',
  });
});

describe('PublishEngine.publishNow', () => {
  it('publishes to all accounts and reports PUBLISHED', async () => {
    const out = await makeEngine().publishNow(['a1', 'a2'], content);
    expect(out.status).toBe(PubStatus.PUBLISHED);
    expect(out.results.map((r) => r.status)).toEqual([
      PubStatus.PUBLISHED,
      PubStatus.PUBLISHED,
    ]);
    expect(out.results[0].externalPostId).toContain('post-facebook-PAGE1');
    // history updated to PUBLISHED with publishedAt set
    const h = [...history.rows.values()];
    expect(
      h.every((r) => r.status === PubStatus.PUBLISHED && r.publishedAt),
    ).toBe(true);
    // two PUBLISH audit entries
    expect(audit.entries.filter((e) => e.action === 'publish')).toHaveLength(2);
  });

  it('reports PART_SUCCESS when one account fails', async () => {
    const out = await makeEngine({ twitter: 'throw' } as any).publishNow(
      ['a1', 'a2'],
      content,
    );
    expect(out.status).toBe(PubStatus.PART_SUCCESS);
    const fail = out.results.find((r) => r.accountId === 'a2')!;
    expect(fail.status).toBe(PubStatus.FAILED);
    expect(fail.error).toBe('publish failed');
    expect(history.rows.get(fail.historyId)!.status).toBe(PubStatus.FAILED);
  });

  it('reports FAILED when all accounts fail', async () => {
    const out = await makeEngine({
      facebook: 'throw',
      twitter: 'throw',
    } as any).publishNow(['a1', 'a2'], content);
    expect(out.status).toBe(PubStatus.FAILED);
  });

  it('marks unknown accounts as failed without a history row', async () => {
    const out = await makeEngine().publishNow(['ghost'], content);
    expect(out.status).toBe(PubStatus.FAILED);
    expect(out.results[0].error).toBe('account_not_found');
    expect(out.results[0].historyId).toBe('');
  });
});

describe('PublishEngine.schedule', () => {
  it('persists scheduled rows and audits them', async () => {
    const runAt = new Date('2026-06-01T12:00:00Z');
    const out = await makeEngine().schedule(
      ['a1', 'a2'],
      { ...content, contentAssetId: 'asset-1' },
      runAt,
    );
    expect(out.scheduledPostIds).toHaveLength(2);
    expect(
      [...scheduled.rows.values()].every((r) => r.status === PubStatus.QUEUED),
    ).toBe(true);
    expect(audit.entries.filter((e) => e.action === 'schedule')).toHaveLength(
      2,
    );
  });
});
