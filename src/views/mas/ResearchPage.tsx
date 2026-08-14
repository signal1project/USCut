import React, { useState } from 'react';
import {
  Flame,
  Zap,
  RefreshCw,
  Search,
  Newspaper,
  ExternalLink,
} from 'lucide-react';
import { useMasApi } from './useMasApi';
import { useTrendingSignals } from './useTrendingSignals';
import type { ContentIdea } from '@mas/ui';
import {
  Button,
  Badge,
  Card,
  CardContent,
  Input,
  Progress,
} from '@/components/ui';
import { cn } from '@/lib/utils';

const SOURCE_VARIANT: Record<string, 'default' | 'info' | 'secondary'> = {
  google: 'info',
  ai_generated: 'default',
  twitter: 'secondary',
};

/** Research page: live trending signals from Google Trends + AI, plus the Idea Scraper (Google News). */
export default function ResearchPage(): React.ReactElement {
  const api = useMasApi();
  const [activeTab, setActiveTab] = useState<'trending' | 'scraper'>(
    'trending',
  );
  const [nicheInput, setNicheInput] = useState('');
  const [debouncedNiche, setDebouncedNiche] = useState('');

  // Content scraper state
  const [scrapeKeyword, setScrapeKeyword] = useState('');
  const [scrapeLoading, setScrapeLoading] = useState(false);
  const [scrapeIdeas, setScrapeIdeas] = useState<ContentIdea[]>([]);
  const [scrapeError, setScrapeError] = useState<string | null>(null);

  const runScrape = async () => {
    if (!api || !scrapeKeyword.trim()) return;
    setScrapeLoading(true);
    setScrapeError(null);
    setScrapeIdeas([]);
    try {
      const result = await api.scrapeContent(scrapeKeyword.trim());
      setScrapeIdeas(result.ideas);
      if (result.ideas.length === 0)
        setScrapeError('No articles found — try a different keyword.');
    } catch (err) {
      setScrapeError(err instanceof Error ? err.message : 'Scrape failed');
    } finally {
      setScrapeLoading(false);
    }
  };

  const { signals, sources, cachedUntil, loading, error, refresh } =
    useTrendingSignals(api, {
      niche: debouncedNiche,
      limit: 20,
    });

  const handleSearch = () => setDebouncedNiche(nicheInput.trim());

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-ink-strong">
          <Search size={18} className="text-accent" />
          Research
        </h2>
        <p className="text-sm text-ink-muted mt-0.5">
          Trending topics and the Idea Scraper — find what to post about. For
          property listings, use the Zillow Scraper on the Listings page.
        </p>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 bg-surface-2 p-1 rounded-lg w-fit">
        {(['trending', 'scraper'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium transition-colors',
              activeTab === tab
                ? 'bg-surface-3 text-ink-strong shadow-sm'
                : 'text-ink-muted hover:text-ink-base',
            )}
          >
            {tab === 'trending' ? <Flame size={12} /> : <Newspaper size={12} />}
            {tab === 'trending' ? 'Trending' : 'Idea Scraper'}
          </button>
        ))}
      </div>

      {/* ── Content Scraper Tab ── */}
      {activeTab === 'scraper' && (
        <div className="space-y-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex gap-2">
                <Input
                  placeholder="Enter keyword to scrape (e.g. mortgage rates, real estate)"
                  value={scrapeKeyword}
                  onChange={(e) => setScrapeKeyword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void runScrape()}
                  className="flex-1"
                />
                <Button
                  onClick={runScrape}
                  disabled={!api || !scrapeKeyword.trim() || scrapeLoading}
                >
                  {scrapeLoading ? (
                    <RefreshCw size={14} className="animate-spin" />
                  ) : (
                    <Search size={14} />
                  )}
                  Scrape
                </Button>
              </div>
              <p className="text-xs text-ink-muted mt-2">
                Pulls live article headlines from Google News — turn them into
                content ideas.
              </p>
            </CardContent>
          </Card>

          {scrapeError && (
            <div className="rounded-md border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
              {scrapeError}
            </div>
          )}

          {scrapeLoading && (
            <div className="flex items-center justify-center py-12 gap-3 text-ink-muted text-sm">
              <RefreshCw size={20} className="animate-spin text-accent" />
              Scraping Google News…
            </div>
          )}

          {scrapeIdeas.length > 0 && (
            <div className="space-y-2">
              {scrapeIdeas.map((idea, i) => (
                <Card
                  key={i}
                  className="hover:border-border/80 transition-colors"
                >
                  <CardContent className="pt-3 pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-ink-strong leading-snug">
                          {idea.title}
                        </p>
                        {idea.snippet && (
                          <p className="text-xs text-ink-muted mt-1 line-clamp-2">
                            {idea.snippet}
                          </p>
                        )}
                        <div className="flex items-center gap-2 mt-1.5">
                          <Badge variant="secondary" className="text-xs">
                            {idea.source}
                          </Badge>
                          {idea.publishedAt && (
                            <span className="text-xs text-ink-subtle">
                              {new Date(idea.publishedAt).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                      {idea.link && (
                        <a
                          href={idea.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 text-ink-muted hover:text-accent transition-colors"
                          title="Open article"
                        >
                          <ExternalLink size={14} />
                        </a>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {!scrapeLoading && scrapeIdeas.length === 0 && !scrapeError && (
            <p className="text-center text-ink-muted py-12 text-sm">
              Enter a keyword and click Scrape to pull content ideas from Google
              News.
            </p>
          )}
        </div>
      )}

      {/* ── Trending Tab ── */}
      {activeTab === 'trending' && (
        <>
          {/* Search bar */}
          <Card>
            <CardContent className="pt-4">
              <div className="flex gap-2">
                <Input
                  placeholder="Enter your niche (e.g. real estate, fitness, tech)"
                  value={nicheInput}
                  onChange={(e) => setNicheInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  className="flex-1"
                />
                <Button onClick={handleSearch} disabled={!api}>
                  <Search size={15} />
                  Search
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Error */}
          {error && (
            <div className="rounded-md border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
              {error}
            </div>
          )}

          {/* API not ready */}
          {!api && !loading && (
            <div className="rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
              API not ready — waiting for the embedded server to start.
            </div>
          )}

          {/* Cache status row */}
          {cachedUntil && (
            <div className="flex items-center flex-wrap gap-2 text-xs text-ink-muted">
              <span>
                Cache expires: {new Date(cachedUntil).toLocaleTimeString()}
              </span>
              <span>·</span>
              <span>Sources:</span>
              {sources.map((s) => (
                <Badge
                  key={s}
                  variant={SOURCE_VARIANT[s] ?? 'secondary'}
                  className="text-xs"
                >
                  {s}
                </Badge>
              ))}
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={refresh}
                className="ml-1 h-6 w-6"
                title="Force refresh"
              >
                <RefreshCw size={12} />
              </Button>
            </div>
          )}

          {/* Loading skeleton */}
          {loading && signals.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-ink-muted text-sm">
              <RefreshCw size={24} className="animate-spin text-accent" />
              Fetching trending signals…
            </div>
          )}

          {/* Empty state */}
          {!loading && signals.length === 0 && api && (
            <p className="text-center text-ink-muted py-12 text-sm">
              {debouncedNiche
                ? `No signals found for "${debouncedNiche}"`
                : 'Enter a niche above and click Search to load trending signals.'}
            </p>
          )}

          {/* Signals list */}
          {signals.length > 0 && (
            <div className="space-y-2">
              {signals.map((signal, index) => (
                <Card
                  key={signal.id}
                  className="hover:border-border/80 transition-colors"
                >
                  <CardContent className="pt-3 pb-3">
                    <div className="flex items-start gap-3">
                      {/* Rank */}
                      <span className="text-lg font-bold text-accent min-w-[2rem] text-center leading-tight">
                        {index + 1}
                      </span>

                      <div className="flex-1 min-w-0 space-y-2">
                        {/* Keyword + source */}
                        <div className="flex items-center flex-wrap gap-2">
                          <span className="text-sm font-semibold text-ink-strong">
                            {signal.keyword}
                          </span>
                          <Badge
                            variant={
                              SOURCE_VARIANT[signal.source] ?? 'secondary'
                            }
                            className="text-xs"
                          >
                            {signal.source}
                          </Badge>
                        </div>

                        {/* Hashtags */}
                        {signal.hashtags.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {signal.hashtags.map((tag) => (
                              <Badge
                                key={tag}
                                variant="info"
                                className="text-xs"
                              >
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        )}

                        {/* Score bars */}
                        <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                          {signal.nicheScore > 0 && (
                            <div>
                              <p className="text-xs text-ink-muted flex items-center gap-1 mb-1">
                                <Zap size={10} /> Niche match{' '}
                                {signal.nicheScore}%
                              </p>
                              <Progress
                                value={signal.nicheScore}
                                className="h-1.5"
                                indicatorClassName={cn(
                                  signal.nicheScore >= 70
                                    ? 'bg-success'
                                    : signal.nicheScore >= 40
                                      ? 'bg-warning'
                                      : 'bg-error',
                                )}
                              />
                            </div>
                          )}

                          {signal.trafficScore !== null && (
                            <div>
                              <p className="text-xs text-ink-muted flex items-center gap-1 mb-1">
                                <Flame size={10} /> Trend volume{' '}
                                {signal.trafficScore}%
                              </p>
                              <Progress
                                value={signal.trafficScore}
                                className="h-1.5"
                                indicatorClassName="bg-info"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
