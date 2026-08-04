import type { RawTrendSignal, TrendFetcher } from './trendingService';

export type PlatformTrendSource =
  | 'tiktok'
  | 'instagram'
  | 'youtube'
  | 'x'
  | 'rumble';

const GOOGLE_NEWS_RSS =
  'https://news.google.com/rss/search?hl=en-US&gl=US&ceid=US:en&q=';

const PLATFORM_QUERIES: Record<PlatformTrendSource, string> = {
  tiktok: 'site:tiktok.com trending OR viral OR creator',
  instagram: 'site:instagram.com/reel trending OR viral OR creator',
  youtube: 'YouTube Shorts trending OR creator trends',
  x: 'site:x.com trending OR viral OR creator',
  rumble: 'site:rumble.com trending OR viral video',
};

function decodeXml(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function normalizeTitle(title: string): string {
  return decodeXml(title)
    .replace(/\s+-\s+[^-]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toHashtags(keyword: string, platform: PlatformTrendSource): string[] {
  const cleaned = keyword.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
  const words = cleaned
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 4);
  const phrase = words.join('');
  const tags = [
    `#${platform}`,
    phrase ? `#${phrase}` : '',
    ...words.map((w) => `#${w.charAt(0).toUpperCase()}${w.slice(1)}`),
  ];
  return [...new Set(tags.filter(Boolean))].slice(0, 5);
}

export function extractGoogleNewsTitles(xml: string): string[] {
  const itemBlocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(
    (m) => m[1],
  );
  return itemBlocks
    .map(
      (item) =>
        item.match(
          /<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title>([\s\S]*?)<\/title>/,
        )?.[1] ??
        item.match(
          /<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title>([\s\S]*?)<\/title>/,
        )?.[2] ??
        '',
    )
    .map(normalizeTitle)
    .filter((title) => title.length > 0);
}

/**
 * Public, no-key platform trend fetcher. It mines Google News RSS for platform-specific
 * creator/trending queries so Phase A gets live-ish TikTok/Instagram/YouTube/X/Rumble
 * intelligence without requiring paid APIs during the internal rollout.
 */
export class PlatformTrendFetcher implements TrendFetcher {
  readonly sourceName: PlatformTrendSource;

  constructor(
    platform: PlatformTrendSource,
    private readonly httpFetch: typeof fetch = fetch,
    private readonly query: string = PLATFORM_QUERIES[platform],
  ) {
    this.sourceName = platform;
  }

  async fetch(): Promise<RawTrendSignal[]> {
    try {
      const resp = await this.httpFetch(
        `${GOOGLE_NEWS_RSS}${encodeURIComponent(this.query)}`,
        {
          headers: { 'User-Agent': 'Social-Manager-AI/1.0' },
        },
      );
      if (!resp.ok) return [];
      const xml = await resp.text();
      return extractGoogleNewsTitles(xml)
        .slice(0, 10)
        .map((keyword, index) => ({
          source: this.sourceName,
          keyword,
          hashtags: toHashtags(keyword, this.sourceName),
          trafficScore: Math.max(20, 90 - index * 7),
        }));
    } catch {
      return [];
    }
  }
}
