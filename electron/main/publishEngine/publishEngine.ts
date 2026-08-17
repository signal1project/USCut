import { AuditAction, PubStatus, type Platform } from '@mas/types';
import type {
  AccountStore,
  AdapterResolver,
  AuditStore,
  PublishContentInput,
  PublishHistoryRecord,
  PublishHistoryStore,
  QueueRunner,
  ScheduledPostRecord,
  ScheduledPostStore,
  TokenResolver,
} from './ports';

export interface PublishEngineDeps {
  accounts: AccountStore;
  history: PublishHistoryStore;
  scheduled: ScheduledPostStore;
  audit: AuditStore;
  resolveToken: TokenResolver;
  resolveAdapter: AdapterResolver;
  queue: QueueRunner;
  now?: () => Date;
}

export interface AccountPublishResult {
  accountId: string;
  status: PubStatus.PUBLISHED | PubStatus.FAILED;
  externalPostId?: string;
  error?: string;
  historyId: string;
}

export interface PublishOutcome {
  status: PubStatus.PUBLISHED | PubStatus.FAILED | PubStatus.PART_SUCCESS;
  results: AccountPublishResult[];
}

export interface ScheduleOutcome {
  scheduledPostIds: string[];
}

/**
 * Orchestrates publishing across accounts: resolves tokens + adapters, runs each
 * publish through the platform rate-limit queue, records history + audit, and
 * collapses per-account outcomes into an overall status (PART_SUCCESS when some
 * accounts succeed and others fail).
 */
export class PublishEngine {
  constructor(private readonly deps: PublishEngineDeps) {}

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  private async publishToAccount(
    accountId: string,
    content: PublishContentInput,
  ): Promise<AccountPublishResult> {
    const account = await this.deps.accounts.getById(accountId);
    if (!account) {
      // No history row possible without a known platform; surface as failure.
      return {
        accountId,
        status: PubStatus.FAILED,
        error: 'account_not_found',
        historyId: '',
      };
    }

    const record = await this.deps.history.create({
      accountId,
      platform: account.platform,
      contentAssetId: content.contentAssetId ?? null,
      status: PubStatus.PUBLISHING,
      attempts: 1,
    });

    try {
      const token = await this.deps.resolveToken(account);
      const adapter = this.deps.resolveAdapter(account.platform);
      const result = await this.deps.queue.run(account.platform, () =>
        adapter.publish(
          {
            accessToken: token,
            externalId: account.externalId,
            meta: account.metadata,
          },
          {
            pubType: content.pubType,
            body: content.body,
            hashtags: content.hashtags,
            mediaUrls: content.mediaUrls,
          },
        ),
      );

      await this.deps.history.update(record.id, {
        status: PubStatus.PUBLISHED,
        externalPostId: result.externalPostId,
        publishedAt: this.now(),
      });
      await this.deps.audit.record(
        AuditAction.PUBLISH,
        'mas_publish_history',
        record.id,
        {
          accountId,
          platform: account.platform,
          externalPostId: result.externalPostId,
        },
      );
      return {
        accountId,
        status: PubStatus.PUBLISHED,
        externalPostId: result.externalPostId,
        historyId: record.id,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.deps.history.update(record.id, {
        status: PubStatus.FAILED,
        error: message,
      });
      await this.deps.audit.record(
        AuditAction.PUBLISH,
        'mas_publish_history',
        record.id,
        {
          accountId,
          platform: account.platform,
          error: message,
        },
      );
      return {
        accountId,
        status: PubStatus.FAILED,
        error: message,
        historyId: record.id,
      };
    }
  }

  /** Publish immediately to every account, returning a combined outcome. */
  async publishNow(
    accountIds: string[],
    content: PublishContentInput,
  ): Promise<PublishOutcome> {
    const results = await Promise.all(
      accountIds.map((id) => this.publishToAccount(id, content)),
    );
    const ok = results.filter((r) => r.status === PubStatus.PUBLISHED).length;
    const status =
      ok === results.length
        ? PubStatus.PUBLISHED
        : ok === 0
          ? PubStatus.FAILED
          : PubStatus.PART_SUCCESS;
    return { status, results };
  }

  /**
   * Persist scheduled-post rows for a future run. The actual firing is wired by
   * the scheduling layer (caller registers runAt → publishNow); this records the
   * intent and returns the row ids so the scheduler can key on them.
   */
  async schedule(
    accountIds: string[],
    content: PublishContentInput & { contentAssetId: string },
    runAt: Date,
  ): Promise<ScheduleOutcome> {
    const ids: string[] = [];
    for (const accountId of accountIds) {
      const account = await this.deps.accounts.getById(accountId);
      if (!account) continue;
      const row = await this.deps.scheduled.create({
        accountId,
        platform: account.platform,
        contentAssetId: content.contentAssetId,
        runAt,
        status: PubStatus.QUEUED,
      });
      await this.deps.audit.record(
        AuditAction.SCHEDULE,
        'mas_scheduled_post',
        row.id,
        {
          accountId,
          platform: account.platform,
          runAt: runAt.toISOString(),
        },
      );
      ids.push(row.id);
    }
    return { scheduledPostIds: ids };
  }

  /** Upcoming scheduled posts, optionally filtered by platform. */
  async listScheduled(platform?: Platform): Promise<ScheduledPostRecord[]> {
    return this.deps.scheduled.list(platform);
  }

  /** Removes a scheduled-post row. Caller is responsible for cancelling the matching timer. */
  async cancelScheduled(id: string): Promise<boolean> {
    return this.deps.scheduled.remove(id);
  }

  /** Recent publish history, optionally filtered by platform/status. */
  async listHistory(filter?: {
    platform?: Platform;
    status?: PubStatus;
    limit?: number;
  }): Promise<PublishHistoryRecord[]> {
    return this.deps.history.list(filter);
  }
}
