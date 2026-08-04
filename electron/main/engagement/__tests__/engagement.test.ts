import { describe, it, expect, beforeEach } from 'vitest';
import { EngagementStatus, type AIProvider, type Platform } from '@mas/types';
import {
  EngagementService,
  detectHighConversion,
  type EngagementItem,
  type EngagementStore,
} from '../engagementService';
import type {
  AccountStore,
  AuditStore,
  EngineAccount,
  QueueRunner,
} from '../../publishEngine/ports';
import type { PlatformAdapter, PlatformComment } from '../../adapters/types';

class FakeAccounts implements AccountStore {
  map = new Map<string, EngineAccount>();
  async getById(id: string) {
    return this.map.get(id) ?? null;
  }
}

class FakeStore implements EngagementStore {
  items = new Map<string, EngagementItem>();
  private seq = 0;
  async create(input: Omit<EngagementItem, 'id'>): Promise<EngagementItem> {
    const id = `e${++this.seq}`;
    const item = { id, ...input };
    this.items.set(id, item);
    return item;
  }
  async getById(id: string) {
    return this.items.get(id) ?? null;
  }
  async update(id: string, patch: any) {
    Object.assign(this.items.get(id)!, patch);
  }
  async existsByExternalCommentId(cid: string) {
    return [...this.items.values()].some((i) => i.externalCommentId === cid);
  }
  async listByStatus(status: EngagementStatus) {
    return [...this.items.values()].filter((i) => i.status === status);
  }
}

class FakeAudit implements AuditStore {
  entries: any[] = [];
  async record(action: any, entity: string, entityId: string, details: any) {
    this.entries.push({ action, entity, entityId, details });
  }
}

const queue: QueueRunner = { run: (_p, t) => t() };

const provider: AIProvider = {
  name: 'claude',
  generateText: async (prompt) => `Draft reply to: ${prompt.slice(0, 10)}`,
  generateImage: async () => 'x',
};

function makeAdapter(
  comments: PlatformComment[],
  replyBehavior: 'ok' | 'throw' = 'ok',
) {
  const calls: any[] = [];
  const resolve = (platform: Platform): PlatformAdapter => ({
    platform,
    publish: async () => ({ externalPostId: 'x' }),
    fetchMetrics: async () => ({
      reach: 0,
      impressions: 0,
      engagements: 0,
      clicks: 0,
    }),
    fetchComments: async () => comments,
    replyToComment: async (_ctx, cid, msg) => {
      calls.push({ cid, msg });
      if (replyBehavior === 'throw') throw new Error('reply failed');
      return { externalCommentId: `reply-${cid}` };
    },
  });
  return { resolve, calls };
}

let accounts: FakeAccounts;
let store: FakeStore;
let audit: FakeAudit;

beforeEach(() => {
  accounts = new FakeAccounts();
  store = new FakeStore();
  audit = new FakeAudit();
  accounts.map.set('a1', {
    id: 'a1',
    platform: 'facebook',
    externalId: 'PAGE1',
    credentialRef: 'r',
  });
});

describe('detectHighConversion', () => {
  it('flags buying-intent phrases', () => {
    expect(detectHighConversion('How much is this?')).toBe(true);
    expect(detectHighConversion('Where can I buy it')).toBe(true);
    expect(detectHighConversion('nice photo!')).toBe(false);
  });
});

describe('EngagementService.ingestComments', () => {
  it('drafts replies and flags high-conversion comments', async () => {
    const { resolve } = makeAdapter([
      {
        externalCommentId: 'c1',
        externalPostId: 'P1',
        authorHandle: 'jane',
        text: 'love this',
      },
      {
        externalCommentId: 'c2',
        externalPostId: 'P1',
        authorHandle: 'joe',
        text: 'whats the price?',
      },
    ]);
    const svc = new EngagementService({
      accounts,
      store,
      audit,
      resolveToken: async () => 'tok',
      resolveAdapter: resolve,
      resolveProvider: () => provider,
      queue,
    });
    const items = await svc.ingestComments('a1', 'P1');
    expect(items).toHaveLength(2);
    expect(items[0].draftReply).toContain('Draft reply');
    expect(items[0].status).toBe(EngagementStatus.PENDING);
    expect(
      items.find((i) => i.externalCommentId === 'c2')!.highConversion,
    ).toBe(true);
    expect(
      items.find((i) => i.externalCommentId === 'c1')!.highConversion,
    ).toBe(false);
  });

  it('skips comments already in the queue (dedupe)', async () => {
    const { resolve } = makeAdapter([
      {
        externalCommentId: 'c1',
        externalPostId: 'P1',
        authorHandle: 'j',
        text: 'hi',
      },
    ]);
    const svc = new EngagementService({
      accounts,
      store,
      audit,
      resolveToken: async () => 't',
      resolveAdapter: resolve,
      resolveProvider: () => provider,
      queue,
    });
    await svc.ingestComments('a1', 'P1');
    const second = await svc.ingestComments('a1', 'P1');
    expect(second).toHaveLength(0);
  });
});

describe('EngagementService.approveAndReply', () => {
  it('posts the draft, marks approved, and audits', async () => {
    const { resolve, calls } = makeAdapter([
      {
        externalCommentId: 'c1',
        externalPostId: 'P1',
        authorHandle: 'j',
        text: 'hi',
      },
    ]);
    const svc = new EngagementService({
      accounts,
      store,
      audit,
      resolveToken: async () => 't',
      resolveAdapter: resolve,
      resolveProvider: () => provider,
      queue,
    });
    const [item] = await svc.ingestComments('a1', 'P1');
    const res = await svc.approveAndReply(item.id);
    expect(res.externalCommentId).toBe('reply-c1');
    expect(calls[0].cid).toBe('c1');
    expect(store.items.get(item.id)!.status).toBe(EngagementStatus.APPROVED);
    expect(audit.entries.some((e) => e.action === 'engage')).toBe(true);
  });

  it('uses an override reply when provided', async () => {
    const { resolve, calls } = makeAdapter([
      {
        externalCommentId: 'c1',
        externalPostId: 'P1',
        authorHandle: 'j',
        text: 'hi',
      },
    ]);
    const svc = new EngagementService({
      accounts,
      store,
      audit,
      resolveToken: async () => 't',
      resolveAdapter: resolve,
      resolveProvider: () => provider,
      queue,
    });
    const [item] = await svc.ingestComments('a1', 'P1');
    await svc.approveAndReply(item.id, 'custom reply');
    expect(calls[0].msg).toBe('custom reply');
  });

  it('marks FAILED when the reply throws', async () => {
    const { resolve } = makeAdapter(
      [
        {
          externalCommentId: 'c1',
          externalPostId: 'P1',
          authorHandle: 'j',
          text: 'hi',
        },
      ],
      'throw',
    );
    const svc = new EngagementService({
      accounts,
      store,
      audit,
      resolveToken: async () => 't',
      resolveAdapter: resolve,
      resolveProvider: () => provider,
      queue,
    });
    const [item] = await svc.ingestComments('a1', 'P1');
    await expect(svc.approveAndReply(item.id)).rejects.toThrow('reply failed');
    expect(store.items.get(item.id)!.status).toBe(EngagementStatus.FAILED);
  });

  it('refuses to re-approve a non-pending item', async () => {
    const { resolve } = makeAdapter([
      {
        externalCommentId: 'c1',
        externalPostId: 'P1',
        authorHandle: 'j',
        text: 'hi',
      },
    ]);
    const svc = new EngagementService({
      accounts,
      store,
      audit,
      resolveToken: async () => 't',
      resolveAdapter: resolve,
      resolveProvider: () => provider,
      queue,
    });
    const [item] = await svc.ingestComments('a1', 'P1');
    await svc.approveAndReply(item.id);
    await expect(svc.approveAndReply(item.id)).rejects.toThrow(/not_pending/);
  });
});

describe('EngagementService.dismiss + listPending', () => {
  it('dismisses items and excludes them from pending', async () => {
    const { resolve } = makeAdapter([
      {
        externalCommentId: 'c1',
        externalPostId: 'P1',
        authorHandle: 'j',
        text: 'hi',
      },
      {
        externalCommentId: 'c2',
        externalPostId: 'P1',
        authorHandle: 'k',
        text: 'price?',
      },
    ]);
    const svc = new EngagementService({
      accounts,
      store,
      audit,
      resolveToken: async () => 't',
      resolveAdapter: resolve,
      resolveProvider: () => provider,
      queue,
    });
    const items = await svc.ingestComments('a1', 'P1');
    await svc.dismiss(items[0].id);
    const pending = await svc.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].externalCommentId).toBe('c2');
  });
});
