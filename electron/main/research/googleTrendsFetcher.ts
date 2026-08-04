import type { TrendFetcher, RawTrendSignal } from './trendingService';

const GOOGLE_TRENDS_RSS =
  'https://trends.google.com/trends/trendingsearches/daily/rss?geo=US';

/**
 * Simple XML title extractor — avoids pulling in a full XML parser.
 * Extracts text between all <title> tags, skips the first (feed title).
 */
function extractTitles(xml: string): string[] {
  const matches = [...xml.matchAll(/<title><!\[CDATA\[(.+?)\]\]><\/title>/g)];
  if (matches.length > 0) {
    return matches.map((m) => m[1].trim());
  }
  // Fallback for non-CDATA title tags.
  const plain = [...xml.matchAll(/<title>(.+?)<\/title>/g)];
  return plain.slice(1).map((m) => m[1].trim()); // skip feed <title>
}

/** Extract approximate traffic volume from <ht:approx_traffic> tags. */
function extractTrafficScores(xml: string): (number | null)[] {
  const matches = [
    ...xml.matchAll(/<ht:approx_traffic>([0-9,+KM]+)<\/ht:approx_traffic>/g),
  ];
  return matches.map((m) => {
    const raw = m[1].replace(/[,+]/g, '');
    const n = parseInt(raw.replace(/K$/i, '000').replace(/M$/i, '000000'), 10);
    return isNaN(n) ? null : Math.min(100, Math.round((n / 500_000) * 100));
  });
}

/** Derive hashtag candidates from a trend keyword. */
function toHashtags(keyword: string): string[] {
  const words = keyword.split(/\s+/).filter((w) => w.length > 2);
  const tag = '#' + keyword.replace(/\s+/g, '');
  const wordTags = words.map(
    (w) => '#' + w.charAt(0).toUpperCase() + w.slice(1),
  );
  return [...new Set([tag, ...wordTags])].slice(0, 5);
}

/**
 * Fetcher that pulls the top 20 trending searches for the US from the Google
 * Trends daily RSS feed (no API key required). Results are cached upstream by
 * TrendingResearchService for 1 hour.
 *
 * Inject `fetcher` in tests to avoid real HTTP calls.
 */
export class GoogleTrendsFetcher implements TrendFetcher {
  readonly sourceName = 'google';

  constructor(private readonly httpFetch: typeof fetch = fetch) {}

  async fetch(): Promise<RawTrendSignal[]> {
    try {
      const resp = await this.httpFetch(GOOGLE_TRENDS_RSS, {
        headers: { 'User-Agent': 'Social-Manager-AI/1.0' },
      });
      if (!resp.ok) return [];
      const xml = await resp.text();

      const titles = extractTitles(xml);
      const scores = extractTrafficScores(xml);

      return titles.map((keyword, i) => ({
        source: 'google',
        keyword,
        hashtags: toHashtags(keyword),
        trafficScore: scores[i] ?? undefined,
      }));
    } catch {
      return [];
    }
  }
}
