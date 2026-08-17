import type { DataSource } from 'typeorm';
import type { AuditAction, Platform, PubStatus } from '@mas/types';
import { ConnectedAccountModel } from '../../db/models/mas/connectedAccount';
import { PublishHistoryModel } from '../../db/models/mas/publishHistory';
import { ScheduledPostModel } from '../../db/models/mas/scheduledPost';
import { AuditLogModel } from '../../db/models/mas/auditLog';
import type {
  AccountStore,
  AuditStore,
  EngineAccount,
  PublishHistoryRecord,
  PublishHistoryStore,
  ScheduledPostRecord,
  ScheduledPostStore,
} from './ports';

// TypeORM-backed implementations of the engine ports (production wiring).

export class TypeOrmAccountStore implements AccountStore {
  constructor(private readonly ds: DataSource) {}
  async getById(id: string): Promise<EngineAccount | null> {
    const row = await this.ds
      .getRepository(ConnectedAccountModel)
      .findOneBy({ id });
    if (!row) return null;
    return {
      id: row.id,
      platform: row.platform,
      externalId: row.externalId,
      credentialRef: row.credentialRef,
      metadata: row.metadata,
    };
  }
}

export class TypeOrmPublishHistoryStore implements PublishHistoryStore {
  constructor(private readonly ds: DataSource) {}
  async create(input: {
    accountId: string;
    platform: Platform;
    contentAssetId: string | null;
    status: PubStatus;
    attempts: number;
  }): Promise<PublishHistoryRecord> {
    const repo = this.ds.getRepository(PublishHistoryModel);
    const saved = await repo.save(
      repo.create({
        ...input,
        externalPostId: '',
        error: '',
        publishedAt: null,
      }),
    );
    return saved as unknown as PublishHistoryRecord;
  }
  async update(
    id: string,
    patch: Partial<
      Pick<
        PublishHistoryRecord,
        'status' | 'externalPostId' | 'error' | 'publishedAt'
      >
    >,
  ): Promise<void> {
    await this.ds.getRepository(PublishHistoryModel).update({ id }, patch);
  }
  async list(filter?: {
    platform?: Platform;
    status?: PubStatus;
    limit?: number;
  }): Promise<PublishHistoryRecord[]> {
    const repo = this.ds.getRepository(PublishHistoryModel);
    const rows = await repo.find({
      where: {
        ...(filter?.platform ? { platform: filter.platform } : {}),
        ...(filter?.status ? { status: filter.status } : {}),
      },
      order: { createdAt: 'DESC' },
      take: filter?.limit ?? 25,
    });
    return rows as unknown as PublishHistoryRecord[];
  }
}

export class TypeOrmScheduledPostStore implements ScheduledPostStore {
  constructor(private readonly ds: DataSource) {}
  async create(input: {
    accountId: string;
    platform: Platform;
    contentAssetId: string;
    runAt: Date;
    status: PubStatus;
  }): Promise<ScheduledPostRecord> {
    const repo = this.ds.getRepository(ScheduledPostModel);
    const saved = await repo.save(repo.create(input));
    return saved as unknown as ScheduledPostRecord;
  }
  async update(
    id: string,
    patch: Partial<Pick<ScheduledPostRecord, 'status'>>,
  ): Promise<void> {
    await this.ds.getRepository(ScheduledPostModel).update({ id }, patch);
  }
  async list(platform?: Platform): Promise<ScheduledPostRecord[]> {
    const repo = this.ds.getRepository(ScheduledPostModel);
    const rows = await repo.find({
      where: platform ? { platform } : {},
      order: { runAt: 'ASC' },
    });
    return rows as unknown as ScheduledPostRecord[];
  }
  async remove(id: string): Promise<boolean> {
    const result = await this.ds.getRepository(ScheduledPostModel).delete({ id });
    return (result.affected ?? 0) > 0;
  }
}

export class TypeOrmAuditStore implements AuditStore {
  constructor(private readonly ds: DataSource) {}
  async record(
    action: AuditAction,
    entity: string,
    entityId: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    const repo = this.ds.getRepository(AuditLogModel);
    await repo.save(repo.create({ action, entity, entityId, details }));
  }
}
