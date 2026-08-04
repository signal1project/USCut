import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { Platform } from '@mas/types';

export type CampaignPackageStatus =
  | 'needs_approval'
  | 'approved'
  | 'scheduled'
  | 'published'
  | 'rejected';

@Entity({ name: 'mas_campaign_package' })
export class CampaignPackageModel {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar' })
  campaignId!: string;

  @Column({ type: 'varchar' })
  campaignTitle!: string;

  @Column({ type: 'text', default: '' })
  objective!: string;

  @Column({ type: 'varchar', default: '' })
  niche!: string;

  @Column({ type: 'simple-json', default: '[]' })
  platforms!: Platform[];

  @Index()
  @Column({ type: 'varchar', default: 'needs_approval' })
  status!: CampaignPackageStatus;

  @Column({ type: 'simple-json', default: '{}' })
  payload!: Record<string, unknown>;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt!: Date;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  updatedAt!: Date;
}
