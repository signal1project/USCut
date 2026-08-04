import type { Platform } from '@mas/types';
import type { CampaignPackageStatus } from '../../db/models/mas';
import type { PublishingFeedbackSnapshot } from './types';
import type { CaptionVariant } from '../capcut';
import type {
  CreateCampaignPackageInput,
  PublishingPlanSnapshot,
  SocialEngineWorkflowDeps,
  SocialEngineWorkflowResult,
  TrendBriefSnapshot,
} from './types';

function slug(input: string): string {
  const value = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return value || 'campaign';
}

function campaignIdFor(title: string, createdAt: Date): string {
  return `camp_${slug(title)}_${createdAt.toISOString().slice(0, 10).replace(/-/g, '')}`;
}

function buildContentBrief(
  input: CreateCampaignPackageInput,
  trends: string[],
  playbookSummaries: string[],
): string {
  return [
    `Campaign: ${input.campaignTitle}`,
    `Objective: ${input.objective}`,
    `Niche: ${input.niche}`,
    `Trend hooks to ride: ${trends.join(', ') || 'none available'}`,
    `Platform strategy context: ${playbookSummaries.join(' | ')}`,
    'Create punchy platform-native social copy with a strong hook, CTA, and safe claims.',
  ].join('\n');
}

function buildScript(
  objective: string,
  trends: string[],
  generatedBodies: string[],
): string {
  const trendLine =
    trends.length > 0
      ? `Tie the message to ${trends.slice(0, 2).join(' and ')}.`
      : 'Tie the message to the audience pain point.';
  const proofLine = generatedBodies[0] ?? objective;
  return `${trendLine} ${proofLine} End with a clear next step and keep the edit fast.`;
}

function fallbackContent(
  input: CreateCampaignPackageInput,
  trends: string[],
  platformPlaybooks: ReturnType<
    SocialEngineWorkflowDeps['algorithm']['getHintsForPlatforms']
  >,
) {
  const trendHook = trends[0] ?? input.niche;
  return {
    provider: 'omobono_fallback',
    items: input.platforms.map((platform) => {
      const playbook = platformPlaybooks.find((p) => p.platform === platform);
      return {
        platform,
        body: `${trendHook}: ${input.objective} ${playbook?.hookAdvice ?? 'Lead with the pain point, show the win, and ask for the next step.'}`,
        hashtags: [
          `#${input.niche.replace(/\s+/g, '')}`,
          `#${platform}`,
          '#Omobono',
        ].slice(0, 5),
      };
    }),
  };
}

function approvalPlan(
  mode: CreateCampaignPackageInput['approvalMode'],
  platforms: Platform[],
): PublishingPlanSnapshot {
  const approvalMode = mode ?? 'dale_required';
  return {
    status:
      approvalMode === 'autopublish_allowed'
        ? 'ready_to_schedule'
        : 'needs_approval',
    approvalMode,
    platforms,
    gates:
      approvalMode === 'dale_required'
        ? [
            'Draft',
            'Omobono review',
            'Dale approval',
            'Schedule/publish',
            'Analytics review',
          ]
        : ['Draft', 'Omobono review', 'Schedule/publish', 'Analytics review'],
  };
}

export class SocialEngineWorkflowService {
  private readonly now: () => Date;

  constructor(private readonly deps: SocialEngineWorkflowDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async createCampaignPackage(
    input: CreateCampaignPackageInput,
  ): Promise<SocialEngineWorkflowResult> {
    const createdAt = this.now();
    const campaignId = campaignIdFor(input.campaignTitle, createdAt);

    const trendResponse = await this.deps.research.getTrending({
      niche: input.niche,
      limit: 20,
    });
    const topSignals = trendResponse.signals.slice(0, 5);
    const trendKeywords = topSignals.map((s) => s.keyword);
    const platformPlaybooks = this.deps.algorithm.getHintsForPlatforms(
      input.platforms,
    );

    const agent = await this.deps.agent.runTask({
      taskType: 'campaign_strategy',
      objective: input.objective,
      context: {
        campaignTitle: input.campaignTitle,
        niche: input.niche,
        platforms: input.platforms,
        trends: trendKeywords,
        playbooks: platformPlaybooks.map((p) => ({
          platform: p.platform,
          summary: p.summary,
          topFormat: p.topFormat,
        })),
      },
      constraints: [
        'Draft/manual approval by default',
        'Keep reusable white-label entity boundaries',
        'Do not autopublish without approval',
      ],
    });

    const playbookSummaries = platformPlaybooks.map(
      (p) => `${p.platform}: ${p.summary}`,
    );
    const brief = buildContentBrief(input, trendKeywords, playbookSummaries);
    let content;
    try {
      content = await this.deps.content.generate({
        brief,
        platforms: input.platforms,
        tone: input.tone,
      });
    } catch {
      content = fallbackContent(input, trendKeywords, platformPlaybooks);
    }
    const captionVariants: CaptionVariant[] = content.items.map((item) => ({
      platform: item.platform,
      body: item.body,
      hashtags: item.hashtags,
    }));

    const hook = trendKeywords[0]
      ? `${trendKeywords[0]}: ${input.objective}`
      : input.objective;
    const script = buildScript(
      input.objective,
      trendKeywords,
      content.items.map((i) => i.body),
    );
    const capcutPackage = this.deps.capcut.createPackage({
      campaignId,
      campaignTitle: input.campaignTitle,
      platforms: input.platforms,
      hook,
      script,
      captionVariants,
      trendKeywords,
      strategyNotes: platformPlaybooks.map(
        (p) => `${p.platform}: ${p.hookAdvice}`,
      ),
    });

    const trendBrief: TrendBriefSnapshot = {
      niche: input.niche,
      signals: topSignals,
      sources: trendResponse.sources,
      cachedUntil: trendResponse.cachedUntil,
    };

    const result: SocialEngineWorkflowResult = {
      workflowId: `workflow_${campaignId}`,
      campaignId,
      campaignTitle: input.campaignTitle,
      objective: input.objective,
      createdAt: createdAt.toISOString(),
      agent,
      trendBrief,
      platformPlaybooks,
      content,
      capcutPackage,
      publishingPlan: approvalPlan(input.approvalMode, input.platforms),
    };

    if (this.deps.packageStore) {
      result.persistedPackage = await this.deps.packageStore.save(result);
    }

    return result;
  }

  async listCampaignPackages(params?: {
    status?: CampaignPackageStatus;
    limit?: number;
  }) {
    return this.deps.packageStore?.list(params) ?? [];
  }

  async getCampaignPackage(id: string) {
    return this.deps.packageStore?.get(id) ?? null;
  }

  async updateCampaignPackageStatus(id: string, status: CampaignPackageStatus) {
    if (!this.deps.packageStore)
      throw new Error('campaign_package_store_not_configured');
    return this.deps.packageStore.updateStatus(id, status);
  }

  async recordPublicationFeedback(
    id: string,
    feedback: PublishingFeedbackSnapshot,
  ) {
    if (!this.deps.packageStore)
      throw new Error('campaign_package_store_not_configured');
    return this.deps.packageStore.recordPublicationFeedback(id, feedback);
  }
}
