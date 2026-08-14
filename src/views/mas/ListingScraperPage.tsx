import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2,
  RefreshCw,
  Search,
  Trash2,
  ExternalLink,
  ShieldCheck,
  ShieldAlert,
  Puzzle,
  Wand2,
  Copy,
  Check,
  Link,
  Film,
  Send,
  Share2,
} from 'lucide-react';
import { PubType } from '@mas/types';
import { useMasApi } from './useMasApi';
import type {
  PropertyListingSummary,
  ListingAdResult,
  ListingVideoResult,
} from '@mas/ui';
import { Button, Badge, Card, CardContent, Input } from '@/components/ui';
import type { ComposerPrefill } from './composerPrefill';

const AD_PLATFORMS = ['facebook', 'instagram', 'linkedin'] as const;

const SOURCE_VARIANT: Record<string, 'default' | 'info' | 'secondary'> = {
  zillow: 'info',
  realtor: 'default',
  redfin: 'secondary',
};

function formatPrice(cents: number | null): string {
  if (!cents) return 'Price N/A';
  const dollars = cents / 100;
  return dollars >= 1_000_000
    ? `$${(dollars / 1_000_000).toFixed(2)}M`
    : `$${dollars.toLocaleString()}`;
}

function specs(l: PropertyListingSummary): string {
  return [
    l.beds ? `${l.beds} bd` : null,
    l.baths ? `${l.baths} ba` : null,
    l.sqft ? `${l.sqft.toLocaleString()} sqft` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function reelCaption(l: PropertyListingSummary): string {
  const loc = [l.city, l.state].filter(Boolean).join(', ');
  const parts = [
    l.address,
    loc || null,
    formatPrice(l.price),
    specs(l) || null,
  ].filter(Boolean);
  return parts.join(' | ');
}

/**
 * Listing Scraper page: browse property listings captured by the USCut
 * Listing Scraper Chrome extension (Zillow / Realtor.com / Redfin).
 * Not to be confused with the Idea Scraper on the Research page, which
 * scrapes news topics — this one captures structured property data.
 */
export default function ListingScraperPage(): React.ReactElement {
  const api = useMasApi();
  const navigate = useNavigate();
  const [listings, setListings] = useState<PropertyListingSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [cityFilter, setCityFilter] = useState('');
  const [appliedCity, setAppliedCity] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.listListings({
        city: appliedCity || undefined,
        limit: 100,
      });
      setListings(result.listings);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load listings');
    } finally {
      setLoading(false);
    }
  }, [api, appliedCity]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const remove = async (id: string) => {
    if (!api) return;
    try {
      await api.deleteListing(id);
      setListings((prev) => prev.filter((l) => l.id !== id));
      setTotal((t) => Math.max(0, t - 1));
      setAds((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  // ── Generate Listing Ad ────────────────────────────────────────────────────
  const [ads, setAds] = useState<Record<string, ListingAdResult>>({});
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const generateAd = async (id: string) => {
    if (!api || generatingId) return;
    setGeneratingId(id);
    setError(null);
    try {
      const result = await api.generateListingAd(id, {
        platforms: [...AD_PLATFORMS],
      });
      setAds((prev) => ({ ...prev, [id]: result }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ad generation failed');
    } finally {
      setGeneratingId(null);
    }
  };

  const copyAd = async (key: string, body: string) => {
    // Hashtags are already embedded in the generated body.
    await navigator.clipboard.writeText(body);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
  };

  // ── Capture by URL ─────────────────────────────────────────────────────────
  const [captureUrl, setCaptureUrl] = useState('');
  const [capturing, setCapturing] = useState(false);

  const captureByUrl = async () => {
    if (!api || !captureUrl.trim()) return;
    setCapturing(true);
    setError(null);
    try {
      await api.captureListingUrl(captureUrl.trim());
      setCaptureUrl('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'URL capture failed');
    } finally {
      setCapturing(false);
    }
  };

  // ── Listing reel generation ────────────────────────────────────────────────
  const [reels, setReels] = useState<Record<string, ListingVideoResult>>({});
  const [reelBusyId, setReelBusyId] = useState<string | null>(null);

  const createReel = async (id: string) => {
    if (!api || reelBusyId) return;
    setReelBusyId(id);
    setError(null);
    try {
      const result = await api.generateListingVideo(id);
      setReels((prev) => ({ ...prev, [id]: result }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reel generation failed');
    } finally {
      setReelBusyId(null);
    }
  };

  const scheduleReel = (listing: PropertyListingSummary) => {
    const reel = reels[listing.id];
    if (!reel) return;
    navigate('/mas/scheduler', {
      state: {
        prefill: {
          pubType: PubType.VIDEO,
          mediaRef: reel.path,
          body: reelCaption(listing),
        } satisfies ComposerPrefill,
      },
    });
  };

  const postReel = (listing: PropertyListingSummary) => {
    const reel = reels[listing.id];
    if (!reel) return;
    navigate('/mas/publish', {
      state: {
        prefill: {
          pubType: PubType.VIDEO,
          mediaRef: reel.path,
          body: reelCaption(listing),
        } satisfies ComposerPrefill,
      },
    });
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-ink-strong">
          <Building2 size={18} className="text-accent" />
          Zillow Scraper
        </h2>
        <p className="text-sm text-ink-muted mt-0.5">
          Property listings captured from Zillow — ready to turn into listing
          ads. Looking for post topics instead? That&apos;s the Idea Scraper on
          the Research page.
        </p>
      </div>

      {/* Extension hint */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-start gap-3">
            <Puzzle size={18} className="text-accent shrink-0 mt-0.5" />
            <div className="text-xs text-ink-muted leading-relaxed">
              <span className="font-medium text-ink-base">How to capture:</span>{' '}
              install the USCut Zillow Scraper Chrome extension (run{' '}
              <code>npm run build:ext</code>, then load <code>dist-ext/</code>{' '}
              via chrome://extensions → Load unpacked). Browse any Zillow
              listing and click the green “Capture Listing” button — it lands
              here automatically while USCut is running.
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Capture by URL */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex gap-2">
            <Input
              placeholder="Paste a listing URL to capture without the extension…"
              value={captureUrl}
              onChange={(e) => setCaptureUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void captureByUrl()}
              className="flex-1"
            />
            <Button
              onClick={() => void captureByUrl()}
              disabled={!api || !captureUrl.trim() || capturing}
            >
              {capturing ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <Link size={14} />
              )}
              Capture URL
            </Button>
          </div>
          <p className="text-xs text-ink-muted mt-2">
            Works on pages with structured listing data (schema.org /
            OpenGraph). Bot-walled pages still need the extension.
          </p>
        </CardContent>
      </Card>

      {/* Filter bar */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex gap-2">
            <Input
              placeholder="Filter by city (e.g. Houston)"
              value={cityFilter}
              onChange={(e) => setCityFilter(e.target.value)}
              onKeyDown={(e) =>
                e.key === 'Enter' && setAppliedCity(cityFilter.trim())
              }
              className="flex-1"
            />
            <Button
              onClick={() => setAppliedCity(cityFilter.trim())}
              disabled={!api}
            >
              <Search size={14} />
              Filter
            </Button>
            <Button
              variant="ghost"
              onClick={refresh}
              disabled={!api || loading}
              title="Refresh"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-md border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
          {error}
        </div>
      )}

      {!api && !loading && (
        <div className="rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          API not ready — waiting for the embedded server to start.
        </div>
      )}

      {loading && listings.length === 0 && (
        <div className="flex items-center justify-center py-12 gap-3 text-ink-muted text-sm">
          <RefreshCw size={20} className="animate-spin text-accent" />
          Loading captured listings…
        </div>
      )}

      {!loading && api && listings.length === 0 && (
        <p className="text-center text-ink-muted py-12 text-sm">
          {appliedCity
            ? `No captured listings match "${appliedCity}".`
            : 'No listings captured yet — browse Zillow with the extension installed.'}
        </p>
      )}

      {listings.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-ink-muted">
            {total} listing{total === 1 ? '' : 's'} captured
          </p>
          {listings.map((l) => (
            <Card
              key={l.id}
              className="hover:border-border/80 transition-colors"
            >
              <CardContent className="pt-3 pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center flex-wrap gap-2">
                      <span className="text-sm font-semibold text-ink-strong">
                        {l.address}, {l.city}, {l.state} {l.zip}
                      </span>
                      <Badge
                        variant={SOURCE_VARIANT[l.source] ?? 'secondary'}
                        className="text-xs"
                      >
                        {l.source}
                      </Badge>
                      {l.status !== 'active' && (
                        <Badge variant="secondary" className="text-xs">
                          {l.status}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-ink-base mt-1">
                      <span className="font-semibold text-accent">
                        {formatPrice(l.price)}
                      </span>
                      {specs(l) && (
                        <span className="text-ink-muted"> · {specs(l)}</span>
                      )}
                    </p>
                    <div className="flex items-center gap-2 mt-1.5">
                      {l.complianceOk ? (
                        <span className="flex items-center gap-1 text-xs text-success">
                          <ShieldCheck size={12} /> Fair Housing clean
                        </span>
                      ) : (
                        <span
                          className="flex items-center gap-1 text-xs text-error"
                          title={l.complianceFlags
                            .map((f) => `${f.rule}: ${f.detail}`)
                            .join('\n')}
                        >
                          <ShieldAlert size={12} /> {l.complianceFlags.length}{' '}
                          compliance flag
                          {l.complianceFlags.length === 1 ? '' : 's'}
                        </span>
                      )}
                      <span className="text-xs text-ink-subtle">
                        {new Date(l.capturedAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="sm"
                      onClick={() => void generateAd(l.id)}
                      disabled={!api || generatingId !== null}
                      title="Generate platform-ready listing ads"
                    >
                      {generatingId === l.id ? (
                        <RefreshCw size={13} className="animate-spin" />
                      ) : (
                        <Wand2 size={13} />
                      )}
                      {ads[l.id] ? 'Regenerate' : 'Generate Ad'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void createReel(l.id)}
                      disabled={!api || reelBusyId !== null}
                      title="Create a vertical video reel from the listing photos (ken burns + narration)"
                    >
                      {reelBusyId === l.id ? (
                        <RefreshCw size={13} className="animate-spin" />
                      ) : (
                        <Film size={13} />
                      )}
                      Create Reel
                    </Button>
                    {l.listingUrl && (
                      <a
                        href={l.listingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-ink-muted hover:text-accent transition-colors p-1.5"
                        title="Open original listing"
                      >
                        <ExternalLink size={14} />
                      </a>
                    )}
                    <button
                      onClick={() => void remove(l.id)}
                      className="text-ink-muted hover:text-error transition-colors p-1.5"
                      title="Delete listing"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Generated reel */}
                {reels[l.id] && (
                  <div className="mt-3 pt-3 border-t border-border/60">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-success flex items-center gap-1.5">
                        <Film size={12} />
                        Reel ready ({reels[l.id].durationSeconds}s,{' '}
                        {reels[l.id].photosUsed} photos
                        {reels[l.id].narrated ? ', narrated' : ''})
                      </p>
                      <div className="flex items-center gap-1.5">
                        <Button
                          size="sm"
                          onClick={() => postReel(l)}
                          title="Open the social composer with this reel attached"
                        >
                          <Share2 size={13} />
                          Post Now
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => scheduleReel(l)}
                          title="Schedule through an API-connected social account"
                        >
                          <Send size={13} />
                          Schedule
                        </Button>
                      </div>
                    </div>
                    <p className="text-xs text-ink-muted mt-1 break-all select-all">
                      {reels[l.id].path}
                    </p>
                  </div>
                )}

                {/* Generated ads */}
                {ads[l.id] && (
                  <div className="mt-3 pt-3 border-t border-border/60 space-y-2">
                    <p className="text-xs text-ink-muted">
                      Generated via{' '}
                      <span className="font-medium text-ink-base">
                        {ads[l.id].provider}
                      </span>
                      {ads[l.id].provider === 'template' &&
                        ' — configure an AI provider in Settings for tailored copy'}
                    </p>
                    {ads[l.id].items.map((ad) => {
                      const key = `${l.id}:${ad.platform}`;
                      return (
                        <div
                          key={key}
                          className="rounded-md bg-surface-2 border border-border/60 p-3"
                        >
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <div className="flex items-center gap-2">
                              <Badge variant="info" className="text-xs">
                                {ad.platform}
                              </Badge>
                              {ad.complianceOk ? (
                                <span className="flex items-center gap-1 text-xs text-success">
                                  <ShieldCheck size={11} /> compliant
                                </span>
                              ) : (
                                <span
                                  className="flex items-center gap-1 text-xs text-error"
                                  title={ad.complianceFlags
                                    .map((f) => `${f.rule}: ${f.detail}`)
                                    .join('\n')}
                                >
                                  <ShieldAlert size={11} /> blocked — do not
                                  publish
                                </span>
                              )}
                            </div>
                            <button
                              onClick={() => void copyAd(key, ad.body)}
                              className="flex items-center gap-1 text-xs text-ink-muted hover:text-accent transition-colors"
                              title="Copy ad text"
                            >
                              {copiedKey === key ? (
                                <Check size={12} />
                              ) : (
                                <Copy size={12} />
                              )}
                              {copiedKey === key ? 'Copied' : 'Copy'}
                            </button>
                          </div>
                          <p className="text-xs text-ink-base whitespace-pre-wrap leading-relaxed">
                            {ad.body}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
