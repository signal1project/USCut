import type { DataSource, Repository } from 'typeorm';
import { TrendSignalModel } from '../../db/models/mas/trendSignal';

/** A single trending topic signal returned to callers. */
export interface TrendSignal {
  id: string;
  source: string;
  keyword: string;
  hashtags: string[];
  trafficScore: number | null;
  nicheScore: number;
  niche: string;
  fetchedAt: Date;
  expiresAt: Date;
}

/** Raw signal coming in from an external fetcher (no niche scoring yet). */
export interface RawTrendSignal {
  source: string;
  keyword: string;
  hashtags?: string[];
  trafficScore?: number;
}

/** Port: anything that can fetch live trend signals (Google RSS, AI, Twitter, ...). */
export interface TrendFetcher {
  readonly sourceName: string;
  fetch(): Promise<RawTrendSignal[]>;
}

export interface TrendingRequest {
  /** Niche/category used for scoring, e.g. "real estate", "fitness". */
  niche?: string;
  /** Filter to specific source names. Omit for all sources. */
  sources?: string[];
  /** Max signals to return (default 20). */
  limit?: number;
}

export interface TrendingResponse {
  signals: TrendSignal[];
  /** ISO timestamp when this cache entry expires. */
  cachedUntil: string;
  sources: string[];
}

/** How long cached entries are valid. */
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Score a keyword against a niche string using keyword overlap.
 * Returns 0–100.  AI semantic scoring is layered on top by the AI fallback fetcher.
 */
export function scoreNiche(keyword: string, niche: string): number {
  if (!niche.trim()) return 50; // no niche given → neutral score

  const nicheTerms = niche.toLowerCase().split(/\s+/);
  const kwLower = keyword.toLowerCase();
  const matches = nicheTerms.filter((t) => kwLower.includes(t));

  if (matches.length === 0) return 10; // no overlap
  if (matches.length === nicheTerms.length) return 95; // full overlap
  return Math.round(10 + (matches.length / nicheTerms.length) * 85);
}

/**
 * TrendingResearchService — fetches live trend signals from registered
 * TrendFetchers, scores them against the requested niche, caches results in
 * SQLite (1-hour TTL), and returns a ranked list.
 *
 * Designed to be injected with any combination of fetchers: in production the
 * GoogleTrendsFetcher and AITrendFallback are always present; a Twitter fetcher
 * can be added when the user has a connected Twitter account.
 */
export class TrendingResearchService {
  private readonly repo: Repository<TrendSignalModel>;

  constructor(
    private readonly dataSource: DataSource,
    private readonly fetchers: TrendFetcher[],
  ) {
    this.repo = dataSource.getRepository(TrendSignalModel);
  }

  async getTrending(req: TrendingRequest = {}): Promise<TrendingResponse> {
    const { niche = '', limit = 20, sources } = req;

    // Prune expired rows first.
    await this.pruneExpired();

    // Check if we have a fresh enough cache for this niche.
    const cached = await this.getCached(niche, sources, limit);
    if (cached.length >= Math.min(limit, 5)) {
      return this.toResponse(cached, limit);
    }

    // Fetch fresh signals from all registered fetchers (in parallel).
    const activeFetchers = sources
      ? this.fetchers.filter((f) => sources.includes(f.sourceName))
      : this.fetchers;

    const rawBatches = await Promise.allSettled(
      activeFetchers.map((f) => f.fetch()),
    );
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CACHE_TTL_MS);

    const toSave: Partial<TrendSignalModel>[] = [];
    for (const batch of rawBatches) {
      if (batch.status === 'rejected') continue;
      for (const raw of batch.value) {
        toSave.push({
          source: raw.source,
          keyword: raw.keyword,
          hashtags: raw.hashtags ?? [],
          trafficScore: raw.trafficScore ?? null,
          nicheScore: scoreNiche(raw.keyword, niche),
          niche,
          fetchedAt: now,
          expiresAt,
        });
      }
    }

    if (toSave.length > 0) {
      await this.repo.save(toSave as TrendSignalModel[]);
    }

    const fresh = await this.getCached(niche, sources, limit);
    return this.toResponse(fresh, limit);
  }

  private async getCached(
    niche: string,
    sources: string[] | undefined,
    limit: number,
  ): Promise<TrendSignalModel[]> {
    const now = new Date();
    const qb = this.repo
      .createQueryBuilder('t')
      .where('t.expiresAt > :now', { now })
      .andWhere('t.niche = :niche', { niche })
      .orderBy('t.nicheScore', 'DESC')
      .addOrderBy('t.trafficScore', 'DESC')
      .limit(limit);

    if (sources && sources.length > 0) {
      qb.andWhere('t.source IN (:...sources)', { sources });
    }

    return qb.getMany();
  }

  private async pruneExpired(): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .delete()
      .where('expiresAt < :now', { now: new Date() })
      .execute();
  }

  private toResponse(
    signals: TrendSignalModel[],
    limit: number,
  ): TrendingResponse {
    const sorted = signals.slice(0, limit).map((s) => ({
      id: s.id,
      source: s.source,
      keyword: s.keyword,
      hashtags: s.hashtags,
      trafficScore: s.trafficScore,
      nicheScore: s.nicheScore,
      niche: s.niche,
      fetchedAt: s.fetchedAt,
      expiresAt: s.expiresAt,
    }));

    const maxExpiry = signals.reduce(
      (max, s) => (s.expiresAt > max ? s.expiresAt : max),
      new Date(0),
    );

    const usedSources = [...new Set(signals.map((s) => s.source))];
    return {
      signals: sorted,
      cachedUntil: maxExpiry.toISOString(),
      sources: usedSources,
    };
  }
}
