import type { DataSource } from 'typeorm';
import { MoreThanOrEqual } from 'typeorm';
import {
  PublishHistoryModel,
  AnalyticsSnapshotModel,
  ScheduledPostModel,
  ContentAssetModel,
} from '../../db/models/mas';
import {
  computeBestTimes,
  nextOccurrence,
  slotLabel,
  DEFAULT_SLOTS,
  type BestTimeSlot,
  type PostPerformance,
} from './bestTimes';
import type { PublishEngine } from '../publishEngine';
import type { Scheduler } from '../scheduling/scheduler';

export interface CalendarEntry {
  id: string;
  accountId: string;
  platform: string;
  runAt: string;
  status: string;
  body: string;
}

export interface BestTimesResult {
  slots: Array<BestTimeSlot & { label: string; nextOccurrence: string }>;
  basedOn: 'history' | 'defaults';
  sampleSize: number;
}

export interface RecycleOutcome {
  requeued: Array<{
    sourcePostId: string;
    accountId: string;
    platform: string;
    runAt: string;
    scheduledPostIds: string[];
  }>;
  skipped: number;
}

export interface InsightsServiceDeps {
  dataSource: DataSource;
  engine: PublishEngine;
  scheduler: Scheduler;
}

/**
 * Cross-cutting insights over the publish/analytics data: content calendar
 * feed, best-time-to-post ranking, and evergreen recycling of top performers.
 */
export class InsightsService {
  constructor(private readonly deps: InsightsServiceDeps) {}

  // ── Calendar ────────────────────────────────────────────────────────────────

  async listScheduled(
    fromISO?: string,
    toISO?: string,
  ): Promise<CalendarEntry[]> {
    const repo = this.deps.dataSource.getRepository(ScheduledPostModel);
    const assets = this.deps.dataSource.getRepository(ContentAssetModel);
    const from = fromISO
      ? new Date(fromISO)
      : new Date(Date.now() - 7 * 86400_000);
    const to = toISO ? new Date(toISO) : new Date(Date.now() + 60 * 86400_000);

    const rows = await repo.find({
      where: { runAt: MoreThanOrEqual(from) },
      order: { runAt: 'ASC' },
      take: 500,
    });

    const entries: CalendarEntry[] = [];
    for (const row of rows) {
      if (row.runAt > to) continue;
      let body = '';
      if (row.contentAssetId) {
        const asset = await assets.findOne({
          where: { id: row.contentAssetId },
        });
        body = asset?.body?.slice(0, 140) ?? '';
      }
      entries.push({
        id: row.id,
        accountId: row.accountId,
        platform: row.platform,
        runAt:
          row.runAt instanceof Date
            ? row.runAt.toISOString()
            : String(row.runAt),
        status: row.status,
        body,
      });
    }
    return entries;
  }

  // ── Best time to post ───────────────────────────────────────────────────────

  async bestTimes(platform?: string): Promise<BestTimesResult> {
    const history = this.deps.dataSource.getRepository(PublishHistoryModel);
    const snapshots = this.deps.dataSource.getRepository(
      AnalyticsSnapshotModel,
    );

    const posts = await history.find({
      take: 1000,
      order: { createdAt: 'DESC' },
    });
    const performances: PostPerformance[] = [];

    for (const post of posts) {
      if (!post.publishedAt || !post.externalPostId) continue;
      if (platform && post.platform !== platform) continue;
      const snaps = await snapshots.find({
        where: { externalPostId: post.externalPostId },
      });
      if (snaps.length === 0) continue;
      const engagements = Math.max(...snaps.map((s) => s.engagements ?? 0));
      performances.push({
        publishedAt:
          post.publishedAt instanceof Date
            ? post.publishedAt
            : new Date(post.publishedAt),
        engagements,
      });
    }

    const usingHistory = performances.length >= 3;
    const slots = usingHistory ? computeBestTimes(performances) : DEFAULT_SLOTS;

    return {
      slots: slots.map((s) => ({
        ...s,
        label: slotLabel(s),
        nextOccurrence: nextOccurrence(s).toISOString(),
      })),
      basedOn: usingHistory ? 'history' : 'defaults',
      sampleSize: performances.length,
    };
  }

  // ── Evergreen recycling ─────────────────────────────────────────────────────

  /**
   * Re-queue the top-performing published posts (by peak engagement snapshot)
   * at upcoming best-time slots, spaced apart. Posts must still have their
   * content asset to be recyclable.
   */
  async recycleTop(count = 3, spacingHours = 24): Promise<RecycleOutcome> {
    const history = this.deps.dataSource.getRepository(PublishHistoryModel);
    const snapshots = this.deps.dataSource.getRepository(
      AnalyticsSnapshotModel,
    );
    const assets = this.deps.dataSource.getRepository(ContentAssetModel);

    const posts = await history.find({
      take: 500,
      order: { createdAt: 'DESC' },
    });
    const ranked: Array<{ post: PublishHistoryModel; engagements: number }> =
      [];

    for (const post of posts) {
      if (!post.externalPostId || !post.contentAssetId) continue;
      const snaps = await snapshots.find({
        where: { externalPostId: post.externalPostId },
      });
      if (snaps.length === 0) continue;
      ranked.push({
        post,
        engagements: Math.max(...snaps.map((s) => s.engagements ?? 0)),
      });
    }
    ranked.sort((a, b) => b.engagements - a.engagements);

    const best = await this.bestTimes();
    const firstSlot = best.slots[0];
    const requeued: RecycleOutcome['requeued'] = [];
    let skipped = 0;

    for (let i = 0; i < Math.min(count, ranked.length); i++) {
      const { post } = ranked[i];
      const asset = await assets.findOne({
        where: { id: post.contentAssetId! },
      });
      if (!asset) {
        skipped += 1;
        continue;
      }
      const runAt = new Date(
        new Date(firstSlot.nextOccurrence).getTime() +
          i * spacingHours * 3600_000,
      );
      const content = {
        pubType: asset.pubType,
        body: asset.body,
        hashtags: asset.hashtags ?? [],
        mediaUrls: asset.mediaRefs ?? [],
        contentAssetId: asset.id,
      };
      const outcome = await this.deps.engine.schedule(
        [post.accountId],
        content,
        runAt,
      );
      for (const id of outcome.scheduledPostIds) {
        this.deps.scheduler.schedule(id, runAt, () => {
          void this.deps.engine.publishNow([post.accountId], content);
        });
      }
      requeued.push({
        sourcePostId: post.id,
        accountId: post.accountId,
        platform: post.platform,
        runAt: runAt.toISOString(),
        scheduledPostIds: outcome.scheduledPostIds,
      });
    }

    return { requeued, skipped };
  }
}
