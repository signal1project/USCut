import type { DataSource } from 'typeorm';
import { AnalyticsSnapshotModel } from '../../db/models/mas/analyticsSnapshot';
import type {
  AnalyticsSnapshotInput,
  AnalyticsSnapshotRecord,
  SnapshotStore,
} from './analyticsService';

export class TypeOrmSnapshotStore implements SnapshotStore {
  constructor(private readonly ds: DataSource) {}

  async create(
    input: AnalyticsSnapshotInput,
  ): Promise<AnalyticsSnapshotRecord> {
    const repo = this.ds.getRepository(AnalyticsSnapshotModel);
    const saved = await repo.save(repo.create(input));
    return saved as unknown as AnalyticsSnapshotRecord;
  }

  async listByAccount(accountId: string): Promise<AnalyticsSnapshotRecord[]> {
    const rows = await this.ds.getRepository(AnalyticsSnapshotModel).find({
      where: { accountId },
      order: { capturedAt: 'DESC' },
    });
    return rows as unknown as AnalyticsSnapshotRecord[];
  }

  async listByPost(externalPostId: string): Promise<AnalyticsSnapshotRecord[]> {
    const rows = await this.ds.getRepository(AnalyticsSnapshotModel).find({
      where: { externalPostId },
      order: { capturedAt: 'DESC' },
    });
    return rows as unknown as AnalyticsSnapshotRecord[];
  }
}
