import type { AIProvider } from '@mas/types';
import type { TrendFetcher, RawTrendSignal } from './trendingService';

/**
 * AI-powered trend fallback.
 * When real platform APIs are unavailable or return too few results, this
 * fetcher asks the configured AI provider to suggest currently trending topics
 * and hashtags for a given niche. Responses are cached upstream (1-hour TTL)
 * so only one AI call is made per refresh window.
 */
export class AITrendFallback implements TrendFetcher {
  readonly sourceName = 'ai_generated';

  constructor(
    private readonly provider: AIProvider,
    /** The niche to generate trends for (e.g. "real estate", "fitness"). */
    private readonly niche: string = 'general',
  ) {}

  async fetch(): Promise<RawTrendSignal[]> {
    const prompt = buildTrendPrompt(this.niche);
    let raw: string;
    try {
      raw = await this.provider.generateText(prompt);
    } catch {
      return [];
    }
    return parseTrendResponse(raw);
  }
}

export function buildTrendPrompt(niche: string): string {
  return `You are a social media trend analyst. List the top 10 trending topics right now that are highly relevant to the "${niche}" niche. For each topic output exactly one JSON object per line (NDJSON) with keys: keyword (string), hashtags (array of strings with # prefix, max 5), nicheScore (integer 0-100 relevance to the niche), trafficScore (integer 0-100 estimated trending intensity). Output ONLY the NDJSON lines, no prose.`;
}

export function parseTrendResponse(raw: string): RawTrendSignal[] {
  const results: RawTrendSignal[] = [];
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    // Strip any markdown code-fence lines.
    if (line.startsWith('```')) continue;
    try {
      const obj = JSON.parse(line) as {
        keyword?: string;
        hashtags?: string[];
        nicheScore?: number;
        trafficScore?: number;
      };
      if (typeof obj.keyword === 'string' && obj.keyword.trim()) {
        results.push({
          source: 'ai_generated',
          keyword: obj.keyword.trim(),
          hashtags: Array.isArray(obj.hashtags) ? obj.hashtags.slice(0, 5) : [],
          trafficScore:
            typeof obj.trafficScore === 'number' ? obj.trafficScore : undefined,
        });
      }
    } catch {
      // Skip malformed lines.
    }
  }
  return results;
}
