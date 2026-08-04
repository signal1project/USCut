import type { Platform } from '@mas/types';
import type { PlatformAlgorithmAgent, AlgorithmHints } from '../algorithm';
import type { ContentService, GenerateResult } from '../content';
import type { TrendingResearchService, TrendSignal } from '../research';
import type { AgentAdapter, AgentTaskResult } from '../agent';
import type { CapCutPackageService, CapCutProductionPackage } from '../capcut';
import type {
  CampaignPackageStore,
  CampaignPackageSummary,
} from './campaignPackageStore';

export type ApprovalMode =
  | 'dale_required'
  | 'omobono_only'
  | 'autopublish_allowed';

export interface CreateCampaignPackageInput {
  campaignTitle: string;
  objective: string;
  niche: string;
  platforms: Platform[];
  approvalMode?: ApprovalMode;
  tone?: string;
}

export interface TrendBriefSnapshot {
  niche: string;
  signals: TrendSignal[];
  sources: string[];
  cachedUntil: string;
}

export interface PublishingFeedbackSnapshot {
  platform: Platform;
  externalPostId: string;
  accountId?: string;
  publishedAt: string;
  analyticsStatus: 'pending_capture' | 'captured';
  notes?: string;
}

export interface PublishingPlanSnapshot {
  status:
    | 'needs_approval'
    | 'ready_to_schedule'
    | 'scheduled'
    | 'published'
    | 'rejected';
  approvalMode: ApprovalMode;
  gates: string[];
  platforms: Platform[];
}

export interface SocialEngineWorkflowResult {
  workflowId: string;
  campaignId: string;
  campaignTitle: string;
  objective: string;
  createdAt: string;
  agent: AgentTaskResult;
  trendBrief: TrendBriefSnapshot;
  platformPlaybooks: AlgorithmHints[];
  content: GenerateResult;
  capcutPackage: CapCutProductionPackage;
  publishingPlan: PublishingPlanSnapshot;
  publishingFeedback?: PublishingFeedbackSnapshot[];
  persistedPackage?: CampaignPackageSummary;
}

export interface SocialEngineWorkflowDeps {
  research: TrendingResearchService;
  algorithm: PlatformAlgorithmAgent;
  content: ContentService;
  capcut: CapCutPackageService;
  agent: AgentAdapter;
  packageStore?: CampaignPackageStore;
  now?: () => Date;
}
