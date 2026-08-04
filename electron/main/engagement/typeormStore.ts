import type { DataSource } from 'typeorm';
import { EngagementStatus } from '@mas/types';
import { EngagementQueueItemModel } from '../../db/models/mas/engagementQueueItem';
import type { EngagementItem, EngagementStore } from './engagementService';

export class TypeOrmEngagementStore implements EngagementStore {
  constructor(private readonly ds: DataSource) {}

  async create(input: Omit<EngagementItem, 'id'>): Promise<EngagementItem> {
    const repo = this.ds.getRepository(EngagementQueueItemModel);
    const saved = await repo.save(repo.create(input));
    return saved as unknown as EngagementItem;
  }

  async getById(id: string): Promise<EngagementItem | null> {
    const row = await this.ds
      .getRepository(EngagementQueueItemModel)
      .findOneBy({ id });
    return (row as unknown as EngagementItem) ?? null;
  }

  async update(
    id: string,
    patch: Partial<Pick<EngagementItem, 'status' | 'draftReply'>>,
  ): Promise<void> {
    await this.ds.getRepository(EngagementQueueItemModel).update({ id }, patch);
  }

  async existsByExternalCommentId(externalCommentId: string): Promise<boolean> {
    const count = await this.ds
      .getRepository(EngagementQueueItemModel)
      .countBy({ externalCommentId });
    return count > 0;
  }

  async listByStatus(status: EngagementStatus): Promise<EngagementItem[]> {
    const rows = await this.ds.getRepository(EngagementQueueItemModel).find({
      where: { status },
      order: { highConversion: 'DESC', createdAt: 'DESC' },
    });
    return rows as unknown as EngagementItem[];
  }
}
