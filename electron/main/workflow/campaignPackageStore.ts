import type { DataSource, Repository } from 'typeorm';
import type { Platform } from '@mas/types';
import {
  CampaignPackageModel,
  type CampaignPackageStatus,
} from '../../db/models/mas';
import type {
  SocialEngineWorkflowResult,
  PublishingFeedbackSnapshot,
} from './types';

export interface CampaignPackageSummary {
  id: string;
  campaignId: string;
  campaignTitle: string;
  objective: string;
  niche: string;
  platforms: Platform[];
  status: CampaignPackageStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignPackageStore {
  save(result: SocialEngineWorkflowResult): Promise<CampaignPackageSummary>;
  list(params?: {
    status?: CampaignPackageStatus;
    limit?: number;
  }): Promise<CampaignPackageSummary[]>;
  get(id: string): Promise<SocialEngineWorkflowResult | null>;
  updateStatus(
    id: string,
    status: CampaignPackageStatus,
  ): Promise<CampaignPackageSummary>;
  recordPublicationFeedback(
    id: string,
    feedback: PublishingFeedbackSnapshot,
  ): Promise<CampaignPackageSummary>;
}

function toSummary(row: CampaignPackageModel): CampaignPackageSummary {
  return {
    id: row.id,
    campaignId: row.campaignId,
    campaignTitle: row.campaignTitle,
    objective: row.objective,
    niche: row.niche,
    platforms: row.platforms,
    status: row.status,
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : String(row.createdAt),
    updatedAt:
      row.updatedAt instanceof Date
        ? row.updatedAt.toISOString()
        : String(row.updatedAt),
  };
}

export class TypeOrmCampaignPackageStore implements CampaignPackageStore {
  private readonly repo: Repository<CampaignPackageModel>;

  constructor(dataSource: DataSource) {
    this.repo = dataSource.getRepository(CampaignPackageModel);
  }

  async save(
    result: SocialEngineWorkflowResult,
  ): Promise<CampaignPackageSummary> {
    const now = new Date();
    const saved = await this.repo.save(
      this.repo.create({
        campaignId: result.campaignId,
        campaignTitle: result.campaignTitle,
        objective: result.objective,
        niche: result.trendBrief.niche,
        platforms: result.publishingPlan.platforms,
        status:
          result.publishingPlan.status === 'ready_to_schedule'
            ? 'approved'
            : 'needs_approval',
        payload: result as unknown as Record<string, unknown>,
        createdAt: new Date(result.createdAt),
        updatedAt: now,
      }),
    );
    return toSummary(saved);
  }

  async list(
    params: { status?: CampaignPackageStatus; limit?: number } = {},
  ): Promise<CampaignPackageSummary[]> {
    const rows = await this.repo.find({
      where: params.status ? { status: params.status } : {},
      order: { createdAt: 'DESC' },
      take: params.limit ?? 50,
    });
    return rows.map(toSummary);
  }

  async get(id: string): Promise<SocialEngineWorkflowResult | null> {
    const row = await this.repo.findOne({ where: { id } });
    return row ? (row.payload as unknown as SocialEngineWorkflowResult) : null;
  }

  async updateStatus(
    id: string,
    status: CampaignPackageStatus,
  ): Promise<CampaignPackageSummary> {
    const row = await this.repo.findOneByOrFail({ id });
    row.status = status;
    row.updatedAt = new Date();
    const payload = row.payload as unknown as SocialEngineWorkflowResult;
    if (payload?.publishingPlan) {
      payload.publishingPlan = {
        ...payload.publishingPlan,
        status: status === 'approved' ? 'ready_to_schedule' : status,
      };
      row.payload = payload as unknown as Record<string, unknown>;
    }
    return toSummary(await this.repo.save(row));
  }

  async recordPublicationFeedback(
    id: string,
    feedback: PublishingFeedbackSnapshot,
  ): Promise<CampaignPackageSummary> {
    const row = await this.repo.findOneByOrFail({ id });
    row.status = 'published';
    row.updatedAt = new Date();
    const payload = row.payload as unknown as SocialEngineWorkflowResult;
    payload.publishingFeedback = [
      ...(payload.publishingFeedback ?? []),
      feedback,
    ];
    if (payload.publishingPlan)
      payload.publishingPlan = {
        ...payload.publishingPlan,
        status: 'published',
      };
    row.payload = payload as unknown as Record<string, unknown>;
    return toSummary(await this.repo.save(row));
  }
}

export class InMemoryCampaignPackageStore implements CampaignPackageStore {
  private readonly rows = new Map<string, CampaignPackageModel>();
  private seq = 0;

  async save(
    result: SocialEngineWorkflowResult,
  ): Promise<CampaignPackageSummary> {
    const now = new Date();
    const row = new CampaignPackageModel();
    row.id = `pkg_${++this.seq}`;
    row.campaignId = result.campaignId;
    row.campaignTitle = result.campaignTitle;
    row.objective = result.objective;
    row.niche = result.trendBrief.niche;
    row.platforms = result.publishingPlan.platforms;
    row.status =
      result.publishingPlan.status === 'ready_to_schedule'
        ? 'approved'
        : 'needs_approval';
    row.payload = result as unknown as Record<string, unknown>;
    row.createdAt = new Date(result.createdAt);
    row.updatedAt = now;
    this.rows.set(row.id, row);
    return toSummary(row);
  }

  async list(
    params: { status?: CampaignPackageStatus; limit?: number } = {},
  ): Promise<CampaignPackageSummary[]> {
    return [...this.rows.values()]
      .filter((row) => !params.status || row.status === params.status)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, params.limit ?? 50)
      .map(toSummary);
  }

  async get(id: string): Promise<SocialEngineWorkflowResult | null> {
    return (
      (this.rows.get(id)?.payload as unknown as SocialEngineWorkflowResult) ??
      null
    );
  }

  async updateStatus(
    id: string,
    status: CampaignPackageStatus,
  ): Promise<CampaignPackageSummary> {
    const row = this.rows.get(id);
    if (!row) throw new Error(`campaign_package_not_found:${id}`);
    row.status = status;
    row.updatedAt = new Date();
    const payload = row.payload as unknown as SocialEngineWorkflowResult;
    if (payload?.publishingPlan)
      payload.publishingPlan = {
        ...payload.publishingPlan,
        status: status === 'approved' ? 'ready_to_schedule' : status,
      };
    row.payload = payload as unknown as Record<string, unknown>;
    return toSummary(row);
  }

  async recordPublicationFeedback(
    id: string,
    feedback: PublishingFeedbackSnapshot,
  ): Promise<CampaignPackageSummary> {
    const row = this.rows.get(id);
    if (!row) throw new Error(`campaign_package_not_found:${id}`);
    row.status = 'published';
    row.updatedAt = new Date();
    const payload = row.payload as unknown as SocialEngineWorkflowResult;
    payload.publishingFeedback = [
      ...(payload.publishingFeedback ?? []),
      feedback,
    ];
    if (payload.publishingPlan)
      payload.publishingPlan = {
        ...payload.publishingPlan,
        status: 'published',
      };
    row.payload = payload as unknown as Record<string, unknown>;
    return toSummary(row);
  }
}
