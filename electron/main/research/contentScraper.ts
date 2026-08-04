/**
 * Content scraper: fetches Google News RSS for a keyword and returns article
 * titles + snippets as content ideas. No API key required.
 */

export interface ContentIdea {
  title: string;
  source: string;
  link: string;
  publishedAt: string | null;
  snippet: string;
}

const GOOGLE_NEWS_RSS = (keyword: string) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(keyword)}&hl=en-US&gl=US&ceid=US:en`;

function extractText(xml: string, tag: string): string[] {
  const re = new RegExp(
    `<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`,
    'gi',
  );
  return [...xml.matchAll(re)].map((m) => m[1].trim());
}

function extractLinks(xml: string): string[] {
  // Google News RSS has <link> tags (not inside CDATA)
  return [...xml.matchAll(/<link>([^<]+)<\/link>/g)].map((m) => m[1].trim());
}

function extractPubDates(xml: string): string[] {
  return [...xml.matchAll(/<pubDate>([^<]+)<\/pubDate>/g)].map((m) =>
    m[1].trim(),
  );
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Scrape Google News for content ideas about a given keyword/niche.
 * Returns up to 15 article ideas.
 */
export async function scrapeContentIdeas(
  keyword: string,
  httpFetch: typeof fetch = fetch,
): Promise<ContentIdea[]> {
  if (!keyword.trim()) return [];
  try {
    const resp = await httpFetch(GOOGLE_NEWS_RSS(keyword), {
      headers: { 'User-Agent': 'AICut-ContentScraper/1.0' },
    });
    if (!resp.ok) return [];
    const xml = await resp.text();

    const titles = extractText(xml, 'title').slice(1); // skip feed title
    const descriptions = extractText(xml, 'description').slice(1);
    const links = extractLinks(xml).slice(1); // first <link> is feed self-link
    const pubDates = extractPubDates(xml);

    return titles.slice(0, 15).map((title, i) => ({
      title,
      source: extractSourceFromTitle(title),
      link: links[i] ?? '',
      publishedAt: pubDates[i] ?? null,
      snippet: stripHtml(descriptions[i] ?? '').slice(0, 200),
    }));
  } catch {
    return [];
  }
}

/** Google News embeds "Source Name - Google News" style in some titles. */
function extractSourceFromTitle(title: string): string {
  const m = title.match(/ - ([^-]+)$/);
  return m ? m[1].trim() : 'Google News';
}
