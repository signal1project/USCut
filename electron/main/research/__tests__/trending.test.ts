import { describe, it, expect } from 'vitest';
import {
  scoreNiche,
  TrendingResearchService,
  type TrendFetcher,
  type RawTrendSignal,
} from '../trendingService';
import { GoogleTrendsFetcher } from '../googleTrendsFetcher';
import {
  PlatformTrendFetcher,
  extractGoogleNewsTitles,
} from '../platformTrendFetcher';
import {
  buildTrendPrompt,
  parseTrendResponse,
  AITrendFallback,
} from '../aiTrendFallback';
import type { AIProvider } from '@mas/types';

// ── scoreNiche ────────────────────────────────────────────────────────────────

describe('scoreNiche', () => {
  it('returns 50 for empty niche', () => {
    expect(scoreNiche('Bitcoin rally', '')).toBe(50);
  });

  it('returns 95 for full keyword overlap', () => {
    expect(scoreNiche('real estate market', 'real estate')).toBe(95);
  });

  it('returns 10 for no overlap', () => {
    expect(scoreNiche('World Cup soccer', 'real estate')).toBe(10);
  });

  it('returns mid score for partial overlap', () => {
    const score = scoreNiche('real estate tips', 'real estate investing');
    expect(score).toBeGreaterThan(10);
    expect(score).toBeLessThan(95);
  });

  it('is case-insensitive', () => {
    expect(scoreNiche('REAL ESTATE NEWS', 'real estate')).toBe(95);
  });
});

// ── GoogleTrendsFetcher ───────────────────────────────────────────────────────

describe('GoogleTrendsFetcher', () => {
  it('returns empty array on non-OK response', async () => {
    const fakeFetch = async () => new Response('error', { status: 500 });
    const fetcher = new GoogleTrendsFetcher(fakeFetch as typeof fetch);
    expect(await fetcher.fetch()).toEqual([]);
  });

  it('parses CDATA titles from RSS', async () => {
    const xml = `<?xml version="1.0"?>
<rss><channel>
  <title>Google Trends Daily</title>
  <item><title><![CDATA[Real Estate Trends]]></title><ht:approx_traffic>200,000+</ht:approx_traffic></item>
  <item><title><![CDATA[Home Buying Tips]]></title><ht:approx_traffic>50K+</ht:approx_traffic></item>
</channel></rss>`;
    const fakeFetch = async () =>
      new Response(xml, {
        status: 200,
        headers: { 'Content-Type': 'application/xml' },
      });
    const fetcher = new GoogleTrendsFetcher(fakeFetch as typeof fetch);
    const signals = await fetcher.fetch();
    expect(signals).toHaveLength(2);
    expect(signals[0].keyword).toBe('Real Estate Trends');
    expect(signals[0].source).toBe('google');
    expect(signals[0].hashtags).toContain('#RealEstateTrends');
    expect(signals[1].keyword).toBe('Home Buying Tips');
  });

  it('returns empty array on network error', async () => {
    const fakeFetch = async (): Promise<Response> => {
      throw new Error('Network error');
    };
    const fetcher = new GoogleTrendsFetcher(fakeFetch as typeof fetch);
    expect(await fetcher.fetch()).toEqual([]);
  });

  it('source name is google', () => {
    expect(new GoogleTrendsFetcher().sourceName).toBe('google');
  });
});

// ── PlatformTrendFetcher ──────────────────────────────────────────────────────

describe('PlatformTrendFetcher', () => {
  it('extracts Google News item titles and strips publisher suffixes', () => {
    const xml = `<rss><channel>
      <item><title><![CDATA[YouTube Shorts growth playbook - Creator News]]></title></item>
      <item><title>TikTok lead gen hooks - Marketing Daily</title></item>
    </channel></rss>`;
    expect(extractGoogleNewsTitles(xml)).toEqual([
      'YouTube Shorts growth playbook',
      'TikTok lead gen hooks',
    ]);
  });

  it('fetches platform-specific live signals without API keys', async () => {
    const xml = `<rss><channel><item><title><![CDATA[Instagram Reels trend for small businesses - Example]]></title></item></channel></rss>`;
    const calls: string[] = [];
    const fakeFetch = async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(xml, {
        status: 200,
        headers: { 'Content-Type': 'application/xml' },
      });
    };
    const fetcher = new PlatformTrendFetcher(
      'instagram',
      fakeFetch as typeof fetch,
    );
    const signals = await fetcher.fetch();
    expect(calls[0]).toContain('news.google.com/rss/search');
    expect(signals[0].source).toBe('instagram');
    expect(signals[0].keyword).toBe(
      'Instagram Reels trend for small businesses',
    );
    expect(signals[0].hashtags).toContain('#instagram');
  });
});

// ── buildTrendPrompt ──────────────────────────────────────────────────────────

describe('buildTrendPrompt', () => {
  it('includes the niche in the prompt', () => {
    const p = buildTrendPrompt('real estate');
    expect(p).toContain('real estate');
    expect(p).toContain('NDJSON');
    expect(p).toContain('keyword');
    expect(p).toContain('hashtags');
  });
});

// ── parseTrendResponse ────────────────────────────────────────────────────────

describe('parseTrendResponse', () => {
  it('parses valid NDJSON lines', () => {
    const raw = [
      JSON.stringify({
        keyword: 'Housing Market Crash',
        hashtags: ['#HousingMarket'],
        trafficScore: 80,
      }),
      JSON.stringify({
        keyword: 'Mortgage Rates',
        hashtags: ['#MortgageRates', '#Rates'],
        nicheScore: 90,
        trafficScore: 70,
      }),
    ].join('\n');
    const signals = parseTrendResponse(raw);
    expect(signals).toHaveLength(2);
    expect(signals[0].keyword).toBe('Housing Market Crash');
    expect(signals[0].hashtags).toEqual(['#HousingMarket']);
    expect(signals[0].trafficScore).toBe(80);
    expect(signals[1].keyword).toBe('Mortgage Rates');
  });

  it('skips markdown code fences', () => {
    const raw =
      '```json\n' + JSON.stringify({ keyword: 'Test', hashtags: [] }) + '\n```';
    const signals = parseTrendResponse(raw);
    expect(signals).toHaveLength(1);
  });

  it('skips malformed lines without throwing', () => {
    const raw =
      'not json\n' +
      JSON.stringify({ keyword: 'Valid', hashtags: [] }) +
      '\nbad json {';
    const signals = parseTrendResponse(raw);
    expect(signals).toHaveLength(1);
    expect(signals[0].keyword).toBe('Valid');
  });

  it('returns empty array for empty input', () => {
    expect(parseTrendResponse('')).toEqual([]);
  });
});

// ── AITrendFallback ───────────────────────────────────────────────────────────

describe('AITrendFallback', () => {
  it('returns parsed signals from provider response', async () => {
    const mockProvider: AIProvider = {
      name: 'openai',
      generateText: async () =>
        JSON.stringify({
          keyword: 'Home Equity Loans',
          hashtags: ['#HomeEquity'],
          trafficScore: 65,
        }),
      generateImage: async () => {
        throw new Error('not supported');
      },
    };
    const fallback = new AITrendFallback(mockProvider, 'real estate');
    const signals = await fallback.fetch();
    expect(signals).toHaveLength(1);
    expect(signals[0].keyword).toBe('Home Equity Loans');
    expect(signals[0].source).toBe('ai_generated');
  });

  it('returns empty array when provider throws', async () => {
    const mockProvider: AIProvider = {
      name: 'openai',
      generateText: async () => {
        throw new Error('API error');
      },
      generateImage: async () => {
        throw new Error('not supported');
      },
    };
    const fallback = new AITrendFallback(mockProvider, 'real estate');
    expect(await fallback.fetch()).toEqual([]);
  });

  it('source name is ai_generated', () => {
    const provider: AIProvider = {
      name: 'claude',
      generateText: async () => '',
      generateImage: async () => '',
    };
    expect(new AITrendFallback(provider).sourceName).toBe('ai_generated');
  });
});

// ── TrendingResearchService (in-memory store) ─────────────────────────────────

/**
 * Minimal DataSource stub sufficient for the service's CRUD.
 * We test only that the service integrates fetchers and scoring correctly,
 * not TypeORM internals (those are covered by the schema test).
 */
function makeDataSourceStub(rows: any[] = []) {
  const store: any[] = [...rows];
  const repo = {
    createQueryBuilder: () => {
      const qb: any = {
        _table: 'trend_signal',
        where: () => qb,
        andWhere: () => qb,
        orderBy: () => qb,
        addOrderBy: () => qb,
        limit: () => qb,
        delete: () => qb,
        execute: async () => {},
        getMany: async () => store.filter((r) => r.expiresAt > new Date()),
      };
      return qb;
    },
    save: async (items: any[]) => {
      store.push(...items);
      return items;
    },
  };
  return { getRepository: () => repo } as any;
}

describe('TrendingResearchService', () => {
  it('fetches from all registered fetchers and returns scored signals', async () => {
    const googleSignals: RawTrendSignal[] = [
      {
        source: 'google',
        keyword: 'real estate market',
        hashtags: ['#RealEstate'],
        trafficScore: 80,
      },
      {
        source: 'google',
        keyword: 'sports highlights',
        hashtags: ['#Sports'],
        trafficScore: 90,
      },
    ];
    const stubFetcher: TrendFetcher = {
      sourceName: 'google',
      fetch: async () => googleSignals,
    };

    const ds = makeDataSourceStub();
    const service = new TrendingResearchService(ds, [stubFetcher]);
    const result = await service.getTrending({
      niche: 'real estate',
      limit: 10,
    });

    expect(result.signals.length).toBeGreaterThan(0);
    expect(result.sources).toContain('google');
    // Real estate keyword should have higher score than sports.
    const re = result.signals.find((s) => s.keyword === 'real estate market');
    const sp = result.signals.find((s) => s.keyword === 'sports highlights');
    if (re && sp) {
      expect(re.nicheScore).toBeGreaterThan(sp.nicheScore);
    }
  });

  it('returns empty response when all fetchers fail', async () => {
    const failFetcher: TrendFetcher = {
      sourceName: 'google',
      fetch: async () => {
        throw new Error('network down');
      },
    };
    const ds = makeDataSourceStub();
    const service = new TrendingResearchService(ds, [failFetcher]);
    const result = await service.getTrending({ niche: 'fitness' });
    expect(result.signals).toEqual([]);
  });

  it('filters by sources when provided', async () => {
    const googleFetcher: TrendFetcher = {
      sourceName: 'google',
      fetch: async () => [
        { source: 'google', keyword: 'google trend', hashtags: [] },
      ],
    };
    const aiFetcher: TrendFetcher = {
      sourceName: 'ai_generated',
      fetch: async () => [
        { source: 'ai_generated', keyword: 'ai trend', hashtags: [] },
      ],
    };

    const ds = makeDataSourceStub();
    const service = new TrendingResearchService(ds, [googleFetcher, aiFetcher]);
    const result = await service.getTrending({
      niche: '',
      sources: ['google'],
    });

    // All returned signals should be from google only.
    result.signals.forEach((s) => expect(s.source).toBe('google'));
  });
});
