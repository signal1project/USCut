import type { DataSource } from 'typeorm';
import type { Platform } from '@mas/types';
import type { CredentialManager } from '../credentials/credentialManager';
import { createOAuthService } from '../oauth';
import { getAdapter } from '../adapters/registry';
import { RateLimitedQueues } from '../scheduling/rateLimitedQueues';
import { Scheduler } from '../scheduling/scheduler';
import { Settings } from '../settings/settings';
import {
  PublishEngine,
  TypeOrmAccountStore,
  TypeOrmAuditStore,
  TypeOrmPublishHistoryStore,
  TypeOrmScheduledPostStore,
  createPublishRouter,
  type EngineAccount,
} from '../publishEngine';
import {
  AnalyticsService,
  TypeOrmSnapshotStore,
  createAnalyticsRouter,
} from '../analytics';
import { ContentService, createContentRouter } from '../content';
import {
  EngagementService,
  TypeOrmEngagementStore,
  createEngagementRouter,
} from '../engagement';
import {
  TrendingResearchService,
  GoogleTrendsFetcher,
  PlatformTrendFetcher,
  AITrendFallback,
  createResearchRouter,
} from '../research';
import { PlatformAlgorithmAgent, createAlgorithmRouter } from '../algorithm';
import {
  TypeOrmListingStore,
  ListingAdService,
  ListingVideoService,
  createListingsRouter,
} from '../listings';
import { InsightsService, createInsightsRouter } from '../insights';
import { ClipService, createClipsRouter } from '../clips';
import path from 'node:path';
import os from 'node:os';
import { createDefaultAgentRegistry, createAgentRouter } from '../agent';
import { CapCutPackageService, createCapCutRouter } from '../capcut';
import {
  TypeOrmCampaignPackageStore,
  SocialEngineWorkflowService,
  createWorkflowRouter,
} from '../workflow';
import type { FeatureRoute } from '../server';
import {
  createAIProvider as buildAIProvider,
  createProviderResolver,
} from '../ai';
import { fireScheduledPost, type PublishNotifier } from './scheduledFiring';
import { ContentAssetModel } from '../../db/models/mas/contentAsset';
import { ConnectedAccountModel } from '../../db/models/mas/connectedAccount';

export interface MasRuntimeDeps {
  dataSource: DataSource;
  settings: Settings;
  credentials: CredentialManager;
  /** Directory for generated artifacts (bio pages, reels). Defaults to ~/.aicut. */
  dataDir?: string;
  /** Surface publish success/failure (e.g. desktop Notification). */
  notifyPublish?: PublishNotifier;
}

export interface MasRuntime {
  routes: FeatureRoute[];
  scheduler: Scheduler;
  publish: PublishEngine;
  content: ContentService;
  analytics: AnalyticsService;
  engagement: EngagementService;
  research: TrendingResearchService;
  algorithm: PlatformAlgorithmAgent;
  agentRegistry: ReturnType<typeof createDefaultAgentRegistry>;
  capcut: CapCutPackageService;
  workflow: SocialEngineWorkflowService;
  listings: TypeOrmListingStore;
  insights: InsightsService;
  /** Root directory for generated artifacts (bio pages, listing reels). */
  dataDir: string;
}

/**
 * Composition root: wires the TypeORM stores, OAuth/token resolution, AI
 * provider selection, rate-limit queue, and scheduler into the four feature
 * services and their API routers. Everything platform-facing flows through here.
 */
export function buildMasRuntime(deps: MasRuntimeDeps): MasRuntime {
  const { dataSource, settings, credentials } = deps;
  const dataDir = deps.dataDir ?? path.join(os.homedir(), '.aicut');

  const oauth = createOAuthService(credentials);
  const queue = new RateLimitedQueues();
  const scheduler = new Scheduler();

  const resolveToken = async (account: EngineAccount): Promise<string> => {
    const config = settings.getPlatformOAuth(account.platform);
    if (!config) {
      throw new Error(
        `No OAuth client configured for ${account.platform}. Set it in Settings.`,
      );
    }
    const bundle = await oauth.ensureFresh(
      account.platform,
      account.credentialRef,
      config,
    );
    return bundle.accessToken;
  };

  const resolveAdapter = (platform: Platform) => getAdapter(platform);

  const resolveProvider = createProviderResolver(settings);
  const resolveImageProvider = () => {
    const img = settings.getImageProvider();
    if (!img) throw new Error('OpenAI API key required for image generation.');
    return buildAIProvider('openai', { apiKey: img.apiKey });
  };

  const accounts = new TypeOrmAccountStore(dataSource);
  const audit = new TypeOrmAuditStore(dataSource);

  const publish = new PublishEngine({
    accounts,
    history: new TypeOrmPublishHistoryStore(dataSource),
    scheduled: new TypeOrmScheduledPostStore(dataSource),
    audit,
    resolveToken,
    resolveAdapter,
    queue,
  });

  // Algorithm agent is created first (no deps) so ContentService can reference it.
  const algorithm = new PlatformAlgorithmAgent();

  const content = new ContentService({
    resolveProvider,
    resolveImageProvider,
    algorithmAgent: algorithm,
    resolveBrandKit: () => settings.getActiveBrandKit(),
  });

  const analytics = new AnalyticsService({
    accounts,
    snapshots: new TypeOrmSnapshotStore(dataSource),
    resolveToken,
    resolveAdapter,
    queue,
  });

  const engagement = new EngagementService({
    accounts,
    store: new TypeOrmEngagementStore(dataSource),
    audit,
    resolveToken,
    resolveAdapter,
    resolveProvider,
    queue,
  });

  // Research: Google Trends RSS + AI fallback (niche is set per-request).
  // The AI fallback uses a closure that re-resolves the provider each call so
  // it stays in sync with the user's active provider setting.
  const resolveTrendProvider = () => {
    try {
      return resolveProvider();
    } catch {
      return null;
    }
  };

  const trendFetchers = [
    new GoogleTrendsFetcher(),
    new PlatformTrendFetcher('tiktok'),
    new PlatformTrendFetcher('instagram'),
    new PlatformTrendFetcher('youtube'),
    new PlatformTrendFetcher('x'),
    new PlatformTrendFetcher('rumble'),
    // AI fallback is instantiated lazily per-request via a wrapper fetcher so
    // we always use the currently-configured AI provider.
    {
      sourceName: 'ai_generated',
      fetch: async () => {
        const p = resolveTrendProvider();
        if (!p) return [];
        const fallback = new AITrendFallback(p, '');
        return fallback.fetch();
      },
    },
  ];

  const research = new TrendingResearchService(dataSource, trendFetchers);
  const listings = new TypeOrmListingStore(dataSource);
  const listingAds = new ListingAdService(listings, content);
  const listingVideos = new ListingVideoService(
    listings,
    path.join(dataDir, 'listing-reels'),
  );
  const insights = new InsightsService({
    dataSource,
    engine: publish,
    scheduler,
  });
  const clips = new ClipService({
    outputDir: path.join(dataDir, 'clips'),
    resolveOpenAiKey: () =>
      settings.getProviderSettings('openai')?.apiKey ?? null,
    resolveProvider: () => {
      try {
        return resolveProvider();
      } catch {
        return null;
      }
    },
  });
  const agentRegistry = createDefaultAgentRegistry();
  const capcut = new CapCutPackageService();
  const packageStore = new TypeOrmCampaignPackageStore(dataSource);
  const workflow = new SocialEngineWorkflowService({
    research,
    algorithm,
    content,
    capcut,
    agent: agentRegistry.getDefault(),
    packageStore,
  });

  const routes: FeatureRoute[] = [
    {
      path: '/publish',
      router: createPublishRouter(
        publish,
        scheduler,
        (postId) =>
          fireScheduledPost(dataSource, publish, postId, deps.notifyPublish),
        async (accountIds, contentInput) => {
          // Persist a content asset so scheduled posts survive restarts.
          const acctRepo = dataSource.getRepository(ConnectedAccountModel);
          const first = accountIds[0]
            ? await acctRepo.findOneBy({ id: accountIds[0] })
            : null;
          const assetRepo = dataSource.getRepository(ContentAssetModel);
          const asset = await assetRepo.save(
            assetRepo.create({
              platform: (first?.platform ?? 'twitter') as Platform,
              pubType: contentInput.pubType,
              body: contentInput.body,
              hashtags: contentInput.hashtags,
              mediaRefs: contentInput.mediaUrls,
            }),
          );
          return asset.id;
        },
      ),
    },
    { path: '/content', router: createContentRouter(content) },
    { path: '/analytics', router: createAnalyticsRouter(analytics) },
    { path: '/engagement', router: createEngagementRouter(engagement) },
    { path: '/research', router: createResearchRouter(research) },
    { path: '/algorithm', router: createAlgorithmRouter(algorithm) },
    { path: '/agent', router: createAgentRouter(agentRegistry) },
    { path: '/capcut', router: createCapCutRouter(capcut) },
    { path: '/workflow', router: createWorkflowRouter(workflow) },
    {
      path: '/listings',
      router: createListingsRouter(listings, {
        adService: listingAds,
        videoService: listingVideos,
      }),
    },
    { path: '/clips', router: createClipsRouter(clips) },
    {
      path: '/insights',
      router: createInsightsRouter({
        service: insights,
        settings,
        outputDir: path.join(dataDir, 'bio-page'),
      }),
    },
  ];

  return {
    routes,
    scheduler,
    publish,
    content,
    analytics,
    engagement,
    research,
    algorithm,
    agentRegistry,
    capcut,
    workflow,
    listings,
    insights,
    dataDir,
  };
}
