import { type Platform } from '@mas/types';
import type {
  AccountStore,
  AdapterResolver,
  QueueRunner,
  TokenResolver,
} from '../publishEngine/ports';

export interface AnalyticsSnapshotInput {
  accountId: string;
  platform: Platform;
  externalPostId: string;
  reach: number;
  impressions: number;
  engagements: number;
  clicks: number;
}

export interface AnalyticsSnapshotRecord extends AnalyticsSnapshotInput {
  id: string;
  capturedAt: Date;
}

export interface SnapshotStore {
  create(input: AnalyticsSnapshotInput): Promise<AnalyticsSnapshotRecord>;
  listByAccount(accountId: string): Promise<AnalyticsSnapshotRecord[]>;
  listByPost(externalPostId: string): Promise<AnalyticsSnapshotRecord[]>;
}

export interface AnalyticsServiceDeps {
  accounts: AccountStore;
  snapshots: SnapshotStore;
  resolveToken: TokenResolver;
  resolveAdapter: AdapterResolver;
  queue: QueueRunner;
}

/**
 * Captures point-in-time metric snapshots for posts by calling each platform
 * adapter's fetchMetrics (through the rate-limit queue) and persisting the
 * normalized result. Snapshots accumulate so the UI can chart trends.
 */
export class AnalyticsService {
  constructor(private readonly deps: AnalyticsServiceDeps) {}

  async captureSnapshot(
    accountId: string,
    externalPostId: string,
  ): Promise<AnalyticsSnapshotRecord> {
    const account = await this.deps.accounts.getById(accountId);
    if (!account) throw new Error(`account_not_found: ${accountId}`);

    const token = await this.deps.resolveToken(account);
    const adapter = this.deps.resolveAdapter(account.platform);
    const metrics = await this.deps.queue.run(account.platform, () =>
      adapter.fetchMetrics(
        {
          accessToken: token,
          externalId: account.externalId,
          meta: account.metadata,
        },
        externalPostId,
      ),
    );

    return this.deps.snapshots.create({
      accountId,
      platform: account.platform,
      externalPostId,
      ...metrics,
    });
  }

  /** Capture snapshots for several posts, isolating per-post failures. */
  async captureMany(
    targets: Array<{ accountId: string; externalPostId: string }>,
  ): Promise<Array<{ externalPostId: string; ok: boolean; error?: string }>> {
    return Promise.all(
      targets.map(async (t) => {
        try {
          await this.captureSnapshot(t.accountId, t.externalPostId);
          return { externalPostId: t.externalPostId, ok: true };
        } catch (err) {
          return {
            externalPostId: t.externalPostId,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );
  }

  getByAccount(accountId: string): Promise<AnalyticsSnapshotRecord[]> {
    return this.deps.snapshots.listByAccount(accountId);
  }

  getByPost(externalPostId: string): Promise<AnalyticsSnapshotRecord[]> {
    return this.deps.snapshots.listByPost(externalPostId);
  }
}
