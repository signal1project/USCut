// End-to-end integration harness — runs the REAL stack (TypeORM + better-sqlite3
// in-memory, real Express API, real services/routers) with only outbound social
// calls + AI faked. Bundled with esbuild and run under Electron's node ABI:
//   esbuild ... --bundle --platform=node --packages=external --outfile=out.cjs
//   ELECTRON_RUN_AS_NODE=1 electron.exe out.cjs
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import {
  AccountStatus,
  EngagementStatus,
  PubStatus,
  PubType,
  type AIProvider,
  type Platform,
} from '@mas/types';

import { ConnectedAccountModel } from '../../../db/models/mas/connectedAccount';
import { ContentAssetModel } from '../../../db/models/mas/contentAsset';
import { PublishHistoryModel } from '../../../db/models/mas/publishHistory';
import { ScheduledPostModel } from '../../../db/models/mas/scheduledPost';
import { EngagementQueueItemModel } from '../../../db/models/mas/engagementQueueItem';
import { AnalyticsSnapshotModel } from '../../../db/models/mas/analyticsSnapshot';
import { AuditLogModel } from '../../../db/models/mas/auditLog';

import { startApiServer } from '../../server';
import type { PlatformAdapter } from '../../adapters/types';
import {
  PublishEngine,
  TypeOrmAccountStore,
  TypeOrmAuditStore,
  TypeOrmPublishHistoryStore,
  TypeOrmScheduledPostStore,
  createPublishRouter,
} from '../../publishEngine';
import {
  AnalyticsService,
  TypeOrmSnapshotStore,
  createAnalyticsRouter,
} from '../../analytics';
import { ContentService, createContentRouter } from '../../content';
import {
  EngagementService,
  TypeOrmEngagementStore,
  createEngagementRouter,
} from '../../engagement';
import { Scheduler, type SchedulerBackend } from '../../scheduling/scheduler';

let failures = 0;
function assert(cond: boolean, label: string) {
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.error(`  FAIL ${label}`);
  }
}

// Fake adapter — records publishes, returns canned metrics/comments.
function fakeAdapter(platform: Platform): PlatformAdapter {
  return {
    platform,
    publish: async (_ctx, input) => ({
      externalPostId: `ext-${input.body.slice(0, 5)}`,
    }),
    fetchMetrics: async () => ({
      reach: 50,
      impressions: 70,
      engagements: 9,
      clicks: 3,
    }),
    fetchComments: async (_ctx, postId) => [
      {
        externalCommentId: `c-${postId}`,
        externalPostId: postId,
        authorHandle: 'fan',
        text: 'what is the price?',
      },
    ],
    replyToComment: async (_ctx, cid) => ({
      externalCommentId: `reply-${cid}`,
    }),
  };
}

const fakeProvider: AIProvider = {
  name: 'claude',
  generateText: async (prompt) => `AI says: ${prompt.slice(0, 20)} #great`,
  generateImage: async () => 'http://img/fake.png',
};

const noopSchedulerBackend: SchedulerBackend = {
  schedule: () => ({ cancel() {} }),
};

async function main() {
  const ds = new DataSource({
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
  console.log('DataSource initialized (better-sqlite3 :memory:)');

  // Seed a connected account.
  const acctRepo = ds.getRepository(ConnectedAccountModel);
  const account = await acctRepo.save(
    acctRepo.create({
      platform: 'facebook',
      accountName: 'Test Page',
      externalId: 'PAGE-1',
      status: AccountStatus.CONNECTED,
      credentialRef: 'facebook:PAGE-1',
      metadata: {},
    }),
  );
  console.log(`Seeded account ${account.id}`);

  const resolveToken = async () => 'fake-token';
  const resolveAdapter = (p: Platform) => fakeAdapter(p);
  const queue = { run: <T>(_p: Platform, t: () => Promise<T>) => t() };

  const publish = new PublishEngine({
    accounts: new TypeOrmAccountStore(ds),
    history: new TypeOrmPublishHistoryStore(ds),
    scheduled: new TypeOrmScheduledPostStore(ds),
    audit: new TypeOrmAuditStore(ds),
    resolveToken,
    resolveAdapter,
    queue,
  });
  const analytics = new AnalyticsService({
    accounts: new TypeOrmAccountStore(ds),
    snapshots: new TypeOrmSnapshotStore(ds),
    resolveToken,
    resolveAdapter,
    queue,
  });
  const content = new ContentService({
    resolveProvider: () => fakeProvider,
    resolveImageProvider: () => fakeProvider,
  });
  const engagement = new EngagementService({
    accounts: new TypeOrmAccountStore(ds),
    store: new TypeOrmEngagementStore(ds),
    audit: new TypeOrmAuditStore(ds),
    resolveToken,
    resolveAdapter,
    resolveProvider: () => fakeProvider,
    queue,
  });

  const scheduler = new Scheduler(noopSchedulerBackend);
  const api = await startApiServer({
    token: 'e2e-token',
    routes: [
      { path: '/publish', router: createPublishRouter(publish, scheduler) },
      { path: '/content', router: createContentRouter(content) },
      { path: '/analytics', router: createAnalyticsRouter(analytics) },
      { path: '/engagement', router: createEngagementRouter(engagement) },
    ],
  });
  console.log(`API listening at ${api.url}`);
  const H = {
    Authorization: 'Bearer e2e-token',
    'Content-Type': 'application/json',
  };
  const post = (p: string, b: unknown) =>
    fetch(`${api.url}${p}`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify(b),
    });
  const get = (p: string) => fetch(`${api.url}${p}`, { headers: H });

  // 1) Publish → DB row persisted
  console.log('\n[publish]');
  const pubRes = await post('/api/publish', {
    accountIds: [account.id],
    pubType: PubType.IMAGE_TEXT,
    body: 'hello world',
  });
  const pubJson = await pubRes.json();
  assert(pubJson.status === PubStatus.PUBLISHED, 'publish returns PUBLISHED');
  assert(
    pubJson.results[0].externalPostId === 'ext-hello',
    'external post id flows back',
  );
  const pubRows = await ds.getRepository(PublishHistoryModel).find();
  assert(
    pubRows.length === 1 && pubRows[0].status === PubStatus.PUBLISHED,
    'publish_history row persisted as PUBLISHED',
  );
  const auditRows = await ds.getRepository(AuditLogModel).find();
  assert(
    auditRows.some((a) => a.action === 'publish'),
    'audit log records publish',
  );

  // 2) Content generation
  console.log('\n[content]');
  const genRes = await post('/api/content/generate', {
    brief: 'spring sale',
    platforms: ['facebook', 'instagram'],
  });
  const genJson = await genRes.json();
  assert(genJson.items.length === 2, 'content generated for 2 platforms');
  assert(genJson.items[0].hashtags.includes('#great'), 'hashtags extracted');

  // 3) Analytics capture → DB row, then read back
  console.log('\n[analytics]');
  const capRes = await post('/api/analytics/capture', {
    accountId: account.id,
    externalPostId: 'ext-hello',
  });
  const capJson = await capRes.json();
  assert(
    capJson.impressions === 70 && capJson.reach === 50,
    'capture returns normalized metrics',
  );
  const listJson = await (
    await get(`/api/analytics?accountId=${account.id}`)
  ).json();
  assert(
    listJson.snapshots.length === 1,
    'analytics snapshot persisted + listed',
  );

  // 4) Engagement ingest → approve
  console.log('\n[engagement]');
  const ingRes = await post('/api/engagement/ingest', {
    accountId: account.id,
    externalPostId: 'ext-hello',
  });
  const ingJson = await ingRes.json();
  assert(ingJson.items.length === 1, 'one comment ingested');
  assert(
    ingJson.items[0].highConversion === true,
    'price comment flagged high-conversion',
  );
  assert(
    ingJson.items[0].draftReply.startsWith('AI says:'),
    'AI draft reply attached',
  );
  const pendingBefore = await (await get('/api/engagement/pending')).json();
  assert(pendingBefore.items.length === 1, 'item is pending');
  const itemId = ingJson.items[0].id;
  const appRes = await post(`/api/engagement/${itemId}/approve`, {});
  const appJson = await appRes.json();
  assert(
    appJson.externalCommentId === `reply-c-ext-hello`,
    'approve posts reply',
  );
  const itemRow = await ds
    .getRepository(EngagementQueueItemModel)
    .findOneByOrFail({ id: itemId });
  assert(
    itemRow.status === EngagementStatus.APPROVED,
    'engagement row marked APPROVED',
  );

  await api.close();
  await ds.destroy();

  console.log(`\n${failures === 0 ? 'E2E PASS' : `E2E FAIL (${failures})`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('E2E ERROR', err);
  process.exit(1);
});
