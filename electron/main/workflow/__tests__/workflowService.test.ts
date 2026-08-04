import { describe, expect, it } from 'vitest';
import type { AIProvider, Platform } from '@mas/types';
import { PlatformAlgorithmAgent } from '../../algorithm';
import { ContentService } from '../../content';
import { CapCutPackageService } from '../../capcut';
import { MockAgentAdapter } from '../../agent';
import {
  InMemoryCampaignPackageStore,
  SocialEngineWorkflowService,
} from '../index';

function makeResearch(signals: any[]) {
  return {
    getTrending: async () => ({
      signals,
      sources: [...new Set(signals.map((s) => s.source))],
      cachedUntil: new Date('2026-06-03T13:00:00Z').toISOString(),
    }),
  } as any;
}

function makeContentService() {
  const provider: AIProvider = {
    name: 'ollama',
    generateText: async (brief) =>
      `Generated from: ${brief.slice(0, 80)} #FamilyOffice`,
    generateImage: async () => 'mock://image',
  };
  return new ContentService({
    resolveProvider: () => provider,
    resolveImageProvider: () => provider,
    algorithmAgent: new PlatformAlgorithmAgent(),
  });
}

// RED tests for the Omobono-managed end-to-end campaign assembly workflow.

describe('SocialEngineWorkflowService', () => {
  it('creates a trend-backed campaign package with Omobono agent notes, content variants, and CapCut output', async () => {
    const service = new SocialEngineWorkflowService({
      research: makeResearch([
        {
          id: 't1',
          source: 'google',
          keyword: 'small business websites',
          hashtags: ['#SmallBusiness'],
          trafficScore: 80,
          nicheScore: 95,
          niche: 'web design',
          fetchedAt: new Date(),
          expiresAt: new Date(),
        },
        {
          id: 't2',
          source: 'google',
          keyword: 'lead generation',
          hashtags: ['#LeadGen'],
          trafficScore: 70,
          nicheScore: 80,
          niche: 'web design',
          fetchedAt: new Date(),
          expiresAt: new Date(),
        },
      ]),
      algorithm: new PlatformAlgorithmAgent(),
      content: makeContentService(),
      capcut: new CapCutPackageService({
        now: () => new Date('2026-06-03T12:00:00Z'),
      }),
      agent: new MockAgentAdapter('omobono'),
      packageStore: new InMemoryCampaignPackageStore(),
    });

    const result = await service.createCampaignPackage({
      campaignTitle: 'Web design offer',
      objective: 'Generate leads for Family Office web design services',
      niche: 'web design',
      platforms: ['instagram', 'youtube'] as Platform[],
      approvalMode: 'dale_required',
    });

    expect(result.workflowId).toMatch(/^workflow_/);
    expect(result.agent.agentId).toBe('omobono');
    expect(result.trendBrief.signals).toHaveLength(2);
    expect(result.platformPlaybooks.map((p) => p.platform)).toEqual([
      'instagram',
      'youtube',
    ]);
    expect(result.content.items).toHaveLength(2);
    expect(result.capcutPackage.platforms).toEqual(['instagram', 'youtube']);
    expect(result.publishingPlan.status).toBe('needs_approval');
    expect(result.publishingPlan.approvalMode).toBe('dale_required');
    expect(result.persistedPackage?.status).toBe('needs_approval');
    expect(
      await service.listCampaignPackages({ status: 'needs_approval' }),
    ).toHaveLength(1);
    const approved = await service.updateCampaignPackageStatus(
      result.persistedPackage!.id,
      'approved',
    );
    expect(approved.status).toBe('approved');
    const published = await service.recordPublicationFeedback(
      result.persistedPackage!.id,
      {
        platform: 'instagram',
        externalPostId: 'ig_123',
        publishedAt: '2026-06-03T13:00:00.000Z',
        analyticsStatus: 'pending_capture',
      },
    );
    expect(published.status).toBe('published');
    const persisted = await service.getCampaignPackage(
      result.persistedPackage!.id,
    );
    expect(persisted?.publishingFeedback?.[0].externalPostId).toBe('ig_123');
  });

  it('limits trend context so campaigns stay focused on the strongest signals', async () => {
    const signals = Array.from({ length: 8 }, (_, i) => ({
      id: `t${i}`,
      source: 'google',
      keyword: `trend ${i}`,
      hashtags: [`#Trend${i}`],
      trafficScore: 100 - i,
      nicheScore: 90 - i,
      niche: 'fitness',
      fetchedAt: new Date(),
      expiresAt: new Date(),
    }));

    const service = new SocialEngineWorkflowService({
      research: makeResearch(signals),
      algorithm: new PlatformAlgorithmAgent(),
      content: makeContentService(),
      capcut: new CapCutPackageService({
        now: () => new Date('2026-06-03T12:00:00Z'),
      }),
      agent: new MockAgentAdapter('omobono'),
      packageStore: new InMemoryCampaignPackageStore(),
    });

    const result = await service.createCampaignPackage({
      campaignTitle: 'Fitness sprint',
      objective: 'Book consultations',
      niche: 'fitness',
      platforms: ['tiktok'] as Platform[],
    });

    expect(result.trendBrief.signals).toHaveLength(5);
  });

  it('falls back to deterministic Omobono copy when no AI provider is configured', async () => {
    const service = new SocialEngineWorkflowService({
      research: makeResearch([]),
      algorithm: new PlatformAlgorithmAgent(),
      content: {
        generate: async () => {
          throw new Error('No AI provider configured');
        },
      } as any,
      capcut: new CapCutPackageService({
        now: () => new Date('2026-06-03T12:00:00Z'),
      }),
      agent: new MockAgentAdapter('omobono'),
      packageStore: new InMemoryCampaignPackageStore(),
    });

    const result = await service.createCampaignPackage({
      campaignTitle: 'No-key fallback',
      objective: 'Create a package without configured AI credentials',
      niche: 'web design',
      platforms: ['instagram'] as Platform[],
    });

    expect(result.content.provider).toBe('omobono_fallback');
    expect(result.persistedPackage?.status).toBe('needs_approval');
  });
});
