import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
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
  Hammer,
  FolderOpen,
  SlidersHorizontal,
} from 'lucide-react';
import { PubType } from '@mas/types';
import { useMasApi } from './useMasApi';
import type {
  PropertyListingSummary,
  ListingAdResult,
  ListingVideoResult,
} from '@mas/ui';
import {
  Button,
  Badge,
  Card,
  CardContent,
  Input,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Collapsible,
  CollapsibleContent,
} from '@/components/ui';
import type { ComposerPrefill } from './composerPrefill';
import { ipc, hasIpc } from '@/lib/ipc';

const AD_PLATFORMS = ['facebook', 'instagram', 'linkedin'] as const;

const SOURCE_VARIANT: Record<string, 'default' | 'info' | 'secondary'> = {
  zillow: 'info',
  manual: 'secondary',
};

interface ExtensionInfo {
  path: string;
  built: boolean;
  canRebuild: boolean;
}

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
 * Zillow Scraper page: browse property listings captured by the USCut
 * Zillow Scraper Chrome extension. Not to be confused with the Idea Scraper
 * on the Research page, which scrapes news topics — this one captures
 * structured property data.
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

  // Extension capture and paste-URL capture both happen outside this page
  // (a content script, or a raw HTTP call) — the main process pushes this
  // event the moment either one lands a listing, so it shows up here without
  // needing a manual refresh, matching what the capture UI already promises.
  useEffect(() => {
    if (!hasIpc()) return;
    const onCaptured = (_event: unknown, listing: unknown) => {
      const address = (listing as { address?: string })?.address;
      toast.success(
        address ? `Captured: ${address}` : 'New listing captured',
      );
      void refresh();
    };
    ipc.on('listings:captured', onCaptured);
    return () => ipc.off('listings:captured', onCaptured);
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
  const [reelOptionsOpen, setReelOptionsOpen] = useState<
    Record<string, boolean>
  >({});

  interface ReelOptions {
    template: 'legacy' | 'reel-spec';
    priceTier: 'auto' | 'standard' | 'luxury';
    narrationEngine: 'auto' | 'kokoro' | 'sapi' | 'none';
    hookText: string;
  }
  const DEFAULT_REEL_OPTIONS: ReelOptions = {
    template: 'legacy',
    priceTier: 'auto',
    narrationEngine: 'auto',
    hookText: '',
  };
  const [reelOpts, setReelOpts] = useState<Record<string, ReelOptions>>({});
  const getReelOpts = (id: string): ReelOptions =>
    reelOpts[id] ?? DEFAULT_REEL_OPTIONS;
  const setReelOpt = <K extends keyof ReelOptions>(
    id: string,
    key: K,
    value: ReelOptions[K],
  ) => {
    setReelOpts((prev) => ({
      ...prev,
      [id]: { ...getReelOpts(id), [key]: value },
    }));
  };

  const createReel = async (id: string) => {
    if (!api || reelBusyId) return;
    setReelBusyId(id);
    setError(null);
    try {
      const opts = getReelOpts(id);
      const result = await api.generateListingVideo(id, {
        reelTemplate: opts.template,
        ...(opts.template === 'reel-spec'
          ? {
              priceTier: opts.priceTier,
              narrationEngine: opts.narrationEngine,
              hookText: opts.hookText.trim() || undefined,
            }
          : {}),
      });
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

  // ── Chrome extension install walkthrough ───────────────────────────────────
  const [extInfo, setExtInfo] = useState<ExtensionInfo | null>(null);
  const [building, setBuilding] = useState(false);

  const loadExtInfo = useCallback(async () => {
    if (!hasIpc()) return;
    try {
      const info = (await ipc.invoke(
        'listings:extension-info',
      )) as ExtensionInfo;
      setExtInfo(info);
    } catch {
      setExtInfo(null);
    }
  }, []);

  useEffect(() => {
    void loadExtInfo();
  }, [loadExtInfo]);

  const buildExtension = async () => {
    setBuilding(true);
    try {
      await ipc.invoke('listings:build-extension');
      toast.success('Extension built — next, load it into Chrome below.');
      await loadExtInfo();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Build failed');
    } finally {
      setBuilding(false);
    }
  };

  const openChromeExtensions = async () => {
    const result = (await ipc.invoke('listings:open-chrome-extensions')) as {
      launched: boolean;
      copied: boolean;
    };
    // Chrome blocks internal chrome:// URLs from a command-line launch when
    // it's already running — that only reliably works on a cold start, so
    // don't claim success either way. The clipboard copy is the one part
    // that always works; tell the user to paste it themselves.
    if (result.launched) {
      toast.info(
        'Chrome opened — if it didn’t land on the extensions page, paste chrome://extensions (already copied) into a new tab.',
      );
    } else {
      toast.info(
        'Couldn’t find Chrome automatically — chrome://extensions is copied, paste it into a new tab.',
      );
    }
  };

  const revealExtensionFolder = () => {
    void ipc.invoke('listings:reveal-extension-folder');
  };

  const [pathCopied, setPathCopied] = useState(false);
  const copyExtensionPath = async () => {
    if (!extInfo) return;
    await navigator.clipboard.writeText(extInfo.path);
    setPathCopied(true);
    setTimeout(() => setPathCopied(false), 1500);
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

      {/* Extension install walkthrough */}
      <Card>
        <CardContent className="pt-4 pb-4 space-y-3">
          <div className="flex items-start gap-3">
            <Puzzle size={18} className="text-accent shrink-0 mt-0.5" />
            <div className="text-xs text-ink-muted leading-relaxed">
              <span className="font-medium text-ink-base">
                Install the USCut Zillow Scraper extension
              </span>{' '}
              — three steps, once. After that, browse any Zillow listing and
              click the green “Capture Listing” button — it lands here
              automatically while USCut is running.
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pl-[30px]">
            {extInfo?.canRebuild && (
              <Button
                size="sm"
                variant={extInfo.built ? 'outline' : 'default'}
                onClick={() => void buildExtension()}
                disabled={building}
              >
                {building ? (
                  <RefreshCw size={13} className="animate-spin" />
                ) : (
                  <Hammer size={13} />
                )}
                {extInfo.built ? '1. Rebuild extension' : '1. Build extension'}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => void openChromeExtensions()}
            >
              <ExternalLink size={13} />
              {extInfo?.canRebuild ? '2. ' : ''}Open Chrome (copies the
              extensions URL)
            </Button>
            <Button size="sm" variant="outline" onClick={revealExtensionFolder}>
              <FolderOpen size={13} />
              {extInfo?.canRebuild ? '3. ' : ''}Show extension folder
            </Button>
            {extInfo && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void copyExtensionPath()}
                title={extInfo.path}
              >
                {pathCopied ? <Check size={13} /> : <Copy size={13} />}
                Copy folder path
              </Button>
            )}
          </div>

          <p className="text-xs text-ink-muted pl-[30px]">
            If Chrome doesn’t land on the extensions page by itself, open a
            new tab and paste (<strong>chrome://extensions</strong> is
            already copied to your clipboard). Then: turn on{' '}
            <strong>Developer mode</strong> (top right), click{' '}
            <strong>Load unpacked</strong>, and pick the folder above.
          </p>
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
                      title={
                        getReelOpts(l.id).template === 'reel-spec'
                          ? 'Create a vertical reel using the room-bucketed reel-spec template'
                          : 'Create a vertical video reel from the listing photos (ken burns + narration)'
                      }
                    >
                      {reelBusyId === l.id ? (
                        <RefreshCw size={13} className="animate-spin" />
                      ) : (
                        <Film size={13} />
                      )}
                      Create Reel
                    </Button>
                    <button
                      onClick={() =>
                        setReelOptionsOpen((prev) => ({
                          ...prev,
                          [l.id]: !prev[l.id],
                        }))
                      }
                      className="text-ink-muted hover:text-accent transition-colors p-1.5"
                      title="Reel options"
                    >
                      <SlidersHorizontal size={14} />
                    </button>
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

                {/* Reel options */}
                <Collapsible open={!!reelOptionsOpen[l.id]}>
                  <CollapsibleContent>
                    <div className="mt-3 pt-3 border-t border-border/60 grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-ink-muted">
                          Template
                        </label>
                        <Select
                          value={getReelOpts(l.id).template}
                          onValueChange={(v) =>
                            setReelOpt(
                              l.id,
                              'template',
                              v as ReelOptions['template'],
                            )
                          }
                        >
                          <SelectTrigger className="mt-1 h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="legacy">
                              Classic (Ken Burns)
                            </SelectItem>
                            <SelectItem value="reel-spec">
                              Reel Spec (room-bucketed, beta)
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {getReelOpts(l.id).template === 'reel-spec' && (
                        <>
                          <div>
                            <label className="text-xs text-ink-muted">
                              Price tier
                            </label>
                            <Select
                              value={getReelOpts(l.id).priceTier}
                              onValueChange={(v) =>
                                setReelOpt(
                                  l.id,
                                  'priceTier',
                                  v as ReelOptions['priceTier'],
                                )
                              }
                            >
                              <SelectTrigger className="mt-1 h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="auto">
                                  Auto (by price)
                                </SelectItem>
                                <SelectItem value="standard">
                                  Standard
                                </SelectItem>
                                <SelectItem value="luxury">Luxury</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <label className="text-xs text-ink-muted">
                              Narration
                            </label>
                            <Select
                              value={getReelOpts(l.id).narrationEngine}
                              onValueChange={(v) =>
                                setReelOpt(
                                  l.id,
                                  'narrationEngine',
                                  v as ReelOptions['narrationEngine'],
                                )
                              }
                            >
                              <SelectTrigger className="mt-1 h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="auto">
                                  Auto (Kokoro → SAPI)
                                </SelectItem>
                                <SelectItem value="kokoro">
                                  Kokoro (neural voice)
                                </SelectItem>
                                <SelectItem value="sapi">
                                  Windows SAPI
                                </SelectItem>
                                <SelectItem value="none">
                                  No narration
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <label className="text-xs text-ink-muted">
                              Hook text (optional)
                            </label>
                            <Input
                              className="mt-1 h-8 text-xs"
                              placeholder="Auto-generated from listing"
                              value={getReelOpts(l.id).hookText}
                              onChange={(e) =>
                                setReelOpt(l.id, 'hookText', e.target.value)
                              }
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>

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
