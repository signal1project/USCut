import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { DataSource } from 'typeorm';
import {
  PubType,
  PubStatus,
  AccountStatus,
  EngagementStatus,
  AuditAction,
} from '@mas/types';
import {
  ConnectedAccountModel,
  ContentAssetModel,
  PublishHistoryModel,
  ScheduledPostModel,
  EngagementQueueItemModel,
  AnalyticsSnapshotModel,
  AuditLogModel,
} from '../models/mas';

// better-sqlite3 is rebuilt against Electron's ABI (electron-rebuild), so it
// won't load under plain node. Skip — and run under Electron via the .cjs
// harness in this folder — when the ABI doesn't match.
const nativeLoads = (() => {
  try {
    const Database = createRequire(import.meta.url)('better-sqlite3');
    new Database(':memory:').close();
    return true;
  } catch {
    return false;
  }
})();

let ds: DataSource;

describe.skipIf(!nativeLoads)('MAS schema', () => {
  beforeAll(async () => {
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      synchronize: true,
      entities: [
        ConnectedAccountModel,
        ContentAssetModel,
        PublishHistoryModel,
        ScheduledPostModel,
        EngagementQueueItemModel,
        AnalyticsSnapshotModel,
        AuditLogModel,
      ],
    });
    await ds.initialize();
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  it('creates all seven mas_ tables', () => {
    const names = ds.entityMetadatas.map((m) => m.tableName).sort();
    expect(names).toEqual([
      'mas_analytics_snapshot',
      'mas_audit_log',
      'mas_connected_account',
      'mas_content_asset',
      'mas_engagement_queue',
      'mas_publish_history',
      'mas_scheduled_post',
    ]);
  });

  it('round-trips a connected account with defaults', async () => {
    const repo = ds.getRepository(ConnectedAccountModel);
    const saved = await repo.save(repo.create({ platform: 'facebook' }));
    const found = await repo.findOneByOrFail({ id: saved.id });
    expect(found.id).toHaveLength(36);
    expect(found.status).toBe(AccountStatus.DISCONNECTED);
    expect(found.metadata).toEqual({});
    expect(found.tokenExpiresAt).toBeNull();
  });

  it('persists json arrays on content assets', async () => {
    const repo = ds.getRepository(ContentAssetModel);
    const saved = await repo.save(
      repo.create({
        platform: 'instagram',
        pubType: PubType.IMAGE_TEXT,
        body: 'hello',
        hashtags: ['#a', '#b'],
        mediaRefs: ['m1'],
        status: PubStatus.DRAFT,
      }),
    );
    const found = await repo.findOneByOrFail({ id: saved.id });
    expect(found.hashtags).toEqual(['#a', '#b']);
    expect(found.mediaRefs).toEqual(['m1']);
  });

  it('stores boolean highConversion on engagement items', async () => {
    const repo = ds.getRepository(EngagementQueueItemModel);
    const saved = await repo.save(
      repo.create({
        accountId: 'acc-1',
        platform: 'twitter',
        externalCommentId: 'c1',
        highConversion: true,
        status: EngagementStatus.PENDING,
      }),
    );
    const found = await repo.findOneByOrFail({ id: saved.id });
    expect(found.highConversion).toBe(true);
  });

  it('writes audit log, scheduled post, publish history and analytics rows', async () => {
    await ds.getRepository(AuditLogModel).save({
      action: AuditAction.PUBLISH,
      entity: 'mas_content_asset',
      entityId: 'x',
      details: { ok: true },
    });
    await ds.getRepository(ScheduledPostModel).save({
      accountId: 'acc-1',
      platform: 'pinterest',
      contentAssetId: 'asset-1',
      runAt: new Date(),
    });
    await ds.getRepository(PublishHistoryModel).save({
      accountId: 'acc-1',
      platform: 'threads',
      status: PubStatus.PUBLISHED,
    });
    await ds.getRepository(AnalyticsSnapshotModel).save({
      accountId: 'acc-1',
      platform: 'facebook',
      externalPostId: 'p1',
      reach: 10,
    });

    expect(await ds.getRepository(AuditLogModel).count()).toBe(1);
    expect(await ds.getRepository(ScheduledPostModel).count()).toBe(1);
    expect(await ds.getRepository(PublishHistoryModel).count()).toBe(1);
    expect(await ds.getRepository(AnalyticsSnapshotModel).count()).toBe(1);
  });
});
