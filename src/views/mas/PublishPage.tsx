import React, { useState, useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { toast } from 'sonner';
import { Send, RefreshCw, Clock, Image, LogIn, Check } from 'lucide-react';
import { PubType, PLATFORMS, PLATFORM_CONFIG, type Platform } from '@mas/types';
import { PlatformBadge } from '@mas/ui';
import { useMasApi } from './useMasApi';
import { ipc, hasIpc } from '@/lib/ipc';
import { useActiveBrandStore } from '@/store/activeBrandStore';
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Input,
  Label,
  Textarea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui';
import ConnectAccounts from '@/views/onboarding/ConnectAccounts';

interface ConnectedAccount {
  id: string;
  platform: Platform;
  accountName: string;
  externalId: string;
  /** 'webview' = detected via the signed-in browser session (no OAuth
   * token — must post through the webview composer, not the API engine).
   * Anything else = a real OAuth-connected account. */
  source?: string;
  /** Company (BrandProfile id) this account is assigned to, or null/undefined
   * if unassigned. */
  brandId?: string | null;
}

interface FormValues {
  pubType: PubType;
  body: string;
  hashtags: string;
  imageUrl: string;
  scheduleMode: 'now' | 'later';
  scheduledAt: string;
}

const PLATFORM_COLOR: Partial<Record<Platform, string>> = {
  facebook: '#1877f2',
  instagram: '#e1306c',
  twitter: '#1da1f2',
  threads: '#cccccc',
  pinterest: '#e60023',
  youtube: '#ff0000',
  tiktok: '#25f4ee',
  linkedin: '#0a66c2',
};

/** Compose and publish (or schedule) a post to connected social accounts. */
export default function PublishPage(): React.ReactElement {
  const api = useMasApi();
  const {
    activeBrandId,
    brands: activeBrands,
    loaded: brandsLoaded,
    load: loadActiveBrand,
  } = useActiveBrandStore();
  const [submitting, setSubmitting] = useState(false);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [selectedPageIds, setSelectedPageIds] = useState<string[]>([]);
  const [selectedInstagramIds, setSelectedInstagramIds] = useState<string[]>(
    [],
  );
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  // Webview session status per platform
  const [webviewSessions, setWebviewSessions] = useState<
    Partial<Record<Platform, boolean>>
  >({});
  const [platformBrands, setPlatformBrands] = useState<
    Partial<Record<Platform, string>>
  >({});
  const [selectedWebviewPlatforms, setSelectedWebviewPlatforms] = useState<
    Platform[]
  >([]);
  const [showConnectModal, setShowConnectModal] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    control,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: {
      pubType: PubType.IMAGE_TEXT,
      scheduleMode: 'now',
      hashtags: '',
      imageUrl: '',
      scheduledAt: '',
    },
  });

  const pubType = watch('pubType');
  const scheduleMode = watch('scheduleMode');

  const loadAccounts = async () => {
    if (!hasIpc()) return;
    setLoadingAccounts(true);
    try {
      const list = (await ipc.invoke(
        'mas:accounts:list',
      )) as ConnectedAccount[];
      setAccounts(list);
      // Only auto-select real OAuth-connected accounts — webview-detected
      // Facebook Pages have no API token and must be explicitly chosen.
      const apiOnly = list.filter((a) => a.source !== 'webview');
      if (apiOnly.length > 0 && selectedAccountIds.length === 0) {
        setSelectedAccountIds(apiOnly.map((a) => a.id));
      }
    } catch {
      /* silently skip */
    } finally {
      setLoadingAccounts(false);
    }
  };

  const checkWebviewSessions = async () => {
    if (!hasIpc()) return;
    const results: Partial<Record<Platform, boolean>> = {};
    await Promise.all(
      PLATFORMS.map(async (p) => {
        try {
          const res = (await ipc.invoke('mas:social:session-status', p)) as {
            loggedIn: boolean;
          };
          results[p] = res.loggedIn;
        } catch {
          results[p] = false;
        }
      }),
    );
    setWebviewSessions(results);
    // Auto-select all logged-in platforms
    const loggedIn = PLATFORMS.filter((p) => results[p]);
    if (loggedIn.length > 0 && selectedWebviewPlatforms.length === 0) {
      setSelectedWebviewPlatforms(loggedIn);
    }
  };

  useEffect(() => {
    void loadAccounts();
    void checkWebviewSessions();
    if (!brandsLoaded) void loadActiveBrand();
    if (hasIpc()) {
      ipc
        .invoke('mas:brands:platform-assignments')
        .then((r) =>
          setPlatformBrands((r as Partial<Record<Platform, string>>) ?? {}),
        )
        .catch(() => {});
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleAccount = (id: string) => {
    setSelectedAccountIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const togglePage = (id: string) => {
    setSelectedPageIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const toggleInstagramAccount = (id: string) => {
    setSelectedInstagramIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const toggleWebviewPlatform = (p: Platform) => {
    setSelectedWebviewPlatforms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
    );
  };

  // Facebook/Instagram/Threads share one login (posts as *you*, not a
  // company) — Pages are the company-scoped mechanism for Meta, so those
  // three stay unfiltered here. Everything else has a per-platform company
  // dropdown in Connect Accounts, so it can be scoped directly.
  const META_GROUP: Platform[] = ['facebook', 'instagram', 'threads'];
  const connectedPlatforms = PLATFORMS.filter((p) => webviewSessions[p]).filter(
    (p) =>
      !activeBrandId ||
      META_GROUP.includes(p) ||
      platformBrands[p] === activeBrandId,
  );
  // Real OAuth-connected accounts vs. Pages detected from the Facebook
  // webview session — the latter has no token and posts through the
  // webview composer (pageId), never through the API publish engine.
  // When a company is active (not "All companies"), scope both lists to
  // accounts assigned to it — unassigned accounts stay hidden rather than
  // risking a post going out under the wrong business.
  const byActiveBrand = (a: ConnectedAccount) =>
    !activeBrandId || a.brandId === activeBrandId;
  const apiAccounts = accounts
    .filter((a) => a.source !== 'webview')
    .filter(byActiveBrand);
  const facebookPages = accounts
    .filter((a) => a.platform === 'facebook' && a.source === 'webview')
    .filter(byActiveBrand);
  // Linked Instagram accounts detected from the account switcher — posting
  // as a specific one switches the session's active account first (see
  // webviewBridge.ts's post-webview handler).
  const instagramAccounts = accounts
    .filter((a) => a.platform === 'instagram' && a.source === 'webview')
    .filter(byActiveBrand);
  const activeBrandName = activeBrandId
    ? (activeBrands.find((b) => b.id === activeBrandId)?.name ?? null)
    : null;
  const hasAnySession =
    connectedPlatforms.length > 0 ||
    apiAccounts.length > 0 ||
    facebookPages.length > 0 ||
    instagramAccounts.length > 0;

  const onSubmit = async (values: FormValues) => {
    const fullBody = [values.body, values.hashtags?.trim()]
      .filter(Boolean)
      .join('\n\n');

    if (values.scheduleMode === 'later' && !values.scheduledAt) {
      toast.error('Set a date and time to schedule');
      return;
    }

    // ── Webview-session post (primary — no developer app required) ────────────
    const webviewTargets = selectedWebviewPlatforms.filter(
      (p) => webviewSessions[p],
    );
    if (
      webviewTargets.length === 0 &&
      selectedAccountIds.length === 0 &&
      selectedPageIds.length === 0 &&
      selectedInstagramIds.length === 0
    ) {
      toast.error('Select at least one account or platform to post to');
      return;
    }

    setSubmitting(true);
    const errors: string[] = [];

    if (webviewTargets.length > 0) {
      if (values.scheduleMode === 'later') {
        toast.info(
          `Webview posting is instant — scheduling applies only to API-connected accounts.`,
        );
      }
      for (const platform of webviewTargets) {
        try {
          await ipc.invoke('mas:social:post-webview', {
            platform,
            body: fullBody,
          });
          toast.success(`Posted to ${PLATFORM_CONFIG[platform].label} ✓`);
        } catch (e) {
          errors.push(
            `${PLATFORM_CONFIG[platform].label}: ${(e as Error).message}`,
          );
        }
      }
    }

    // ── Facebook Pages (webview session, posts AS the Page) ───────────────────
    if (selectedPageIds.length > 0) {
      for (const pageId of selectedPageIds) {
        const page = facebookPages.find((a) => a.id === pageId);
        if (!page) continue;
        try {
          await ipc.invoke('mas:social:post-webview', {
            platform: 'facebook',
            body: fullBody,
            pageId: page.externalId,
          });
          toast.success(`Posted to ${page.accountName} ✓`);
        } catch (e) {
          errors.push(`${page.accountName}: ${(e as Error).message}`);
        }
      }
    }

    // ── Instagram accounts (webview session, switches active account first) ──
    // This composer has no local-file picker (imageUrl above is a public URL
    // for the API-publish path, not usable for the CDP file attach Instagram
    // needs) — the window opens on the right account with the caption ready
    // on the clipboard, and the user attaches media + posts manually.
    if (selectedInstagramIds.length > 0) {
      for (const accountId of selectedInstagramIds) {
        const account = instagramAccounts.find((a) => a.id === accountId);
        if (!account) continue;
        try {
          await ipc.invoke('mas:social:post-webview', {
            platform: 'instagram',
            body: fullBody,
            accountId: account.externalId,
          });
          toast.success(`Opened composer for @${account.accountName} ✓`);
        } catch (e) {
          errors.push(`@${account.accountName}: ${(e as Error).message}`);
        }
      }
    }

    // ── API-connected account post (secondary — requires developer app OAuth) ─
    if (selectedAccountIds.length > 0 && api) {
      try {
        const runAt =
          values.scheduleMode === 'later' && values.scheduledAt
            ? new Date(values.scheduledAt).toISOString()
            : undefined;

        const result = await api.publish({
          accountIds: selectedAccountIds,
          pubType: values.pubType,
          body: values.body,
          hashtags: (values.hashtags ?? '').split(/\s+/).filter(Boolean),
          mediaRefs: values.imageUrl.trim() ? [values.imageUrl.trim()] : [],
          runAt,
        });

        if ('scheduled' in result && result.scheduled) {
          toast.success(
            `Scheduled for ${new Date(values.scheduledAt).toLocaleString()}`,
          );
        } else {
          toast.success(`API post published ✓`);
        }
      } catch (err) {
        errors.push(
          `API: ${err instanceof Error ? err.message : 'Publish failed'}`,
        );
      }
    }

    if (errors.length > 0) toast.error(errors.join('\n'));
    setSubmitting(false);
  };

  const minDateTime = new Date(Date.now() + 60_000).toISOString().slice(0, 16);

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-4">
      {showConnectModal && (
        <ConnectAccounts
          onClose={() => {
            setShowConnectModal(false);
            void checkWebviewSessions();
          }}
        />
      )}

      {/* Platform picker — webview sessions (primary path, no dev app needed) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            Post to
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  void checkWebviewSessions();
                  void loadAccounts();
                }}
                className="text-ink-muted hover:text-ink-base transition-colors"
                title="Refresh"
              >
                <RefreshCw
                  size={13}
                  className={loadingAccounts ? 'animate-spin' : ''}
                />
              </button>
              <button
                onClick={() => setShowConnectModal(true)}
                className="flex items-center gap-1 text-[11px] font-medium text-[#4d7cff] hover:underline"
              >
                <LogIn size={12} /> Connect accounts
              </button>
            </div>
          </CardTitle>
          <CardDescription>
            {!hasAnySession
              ? 'No accounts connected — click "Connect accounts" to sign in to your social platforms.'
              : activeBrandName
                ? `Showing accounts for ${activeBrandName} — switch companies from Home.`
                : 'Select which platforms to post to.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Webview-connected platforms */}
          {connectedPlatforms.length > 0 && (
            <div>
              <p className="text-[10px] text-ink-muted mb-2">
                Signed-in platforms (click to toggle):
              </p>
              <div className="flex flex-wrap gap-2">
                {connectedPlatforms.map((p) => {
                  const selected = selectedWebviewPlatforms.includes(p);
                  return (
                    <button
                      key={p}
                      onClick={() => toggleWebviewPlatform(p)}
                      className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                        selected
                          ? 'border-transparent text-white'
                          : 'border-border text-ink-muted hover:border-accent/30'
                      }`}
                      style={
                        selected
                          ? { background: PLATFORM_COLOR[p] ?? '#4d7cff' }
                          : {}
                      }
                    >
                      {selected && <Check size={10} />}
                      {PLATFORM_CONFIG[p].label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Facebook Pages detected from the webview session — posts as the Page */}
          {facebookPages.length > 0 && (
            <div>
              <p className="text-[10px] text-ink-muted mb-2">
                Facebook Pages (posts as the Page, same Meta login):
              </p>
              <div className="flex flex-wrap gap-2">
                {facebookPages.map((page) => {
                  const selected = selectedPageIds.includes(page.id);
                  return (
                    <button
                      key={page.id}
                      onClick={() => togglePage(page.id)}
                      className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                        selected
                          ? 'bg-accent/20 text-accent border-accent/40'
                          : 'border-border text-ink-muted hover:border-accent/30'
                      }`}
                    >
                      <PlatformBadge platform={page.platform} />
                      <span>{page.accountName}</span>
                      {selected && <span>✓</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Instagram accounts detected from the account switcher — posting
              switches the session's active account to this one first */}
          {instagramAccounts.length > 0 && (
            <div>
              <p className="text-[10px] text-ink-muted mb-2">
                Instagram accounts (switches to this account, opens window to
                finish):
              </p>
              <div className="flex flex-wrap gap-2">
                {instagramAccounts.map((account) => {
                  const selected = selectedInstagramIds.includes(account.id);
                  return (
                    <button
                      key={account.id}
                      onClick={() => toggleInstagramAccount(account.id)}
                      className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                        selected
                          ? 'bg-accent/20 text-accent border-accent/40'
                          : 'border-border text-ink-muted hover:border-accent/30'
                      }`}
                    >
                      <PlatformBadge platform={account.platform} />
                      <span>@{account.accountName}</span>
                      {selected && <span>✓</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* API-connected accounts (developer app OAuth) */}
          {apiAccounts.length > 0 && (
            <div>
              <p className="text-[10px] text-ink-muted mb-2">
                API-connected accounts:
              </p>
              <div className="flex flex-wrap gap-2">
                {apiAccounts.map((acc) => {
                  const selected = selectedAccountIds.includes(acc.id);
                  return (
                    <button
                      key={acc.id}
                      onClick={() => toggleAccount(acc.id)}
                      className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                        selected
                          ? 'bg-accent/20 text-accent border-accent/40'
                          : 'border-border text-ink-muted hover:border-accent/30'
                      }`}
                    >
                      <PlatformBadge platform={acc.platform} />
                      <span>{acc.accountName}</span>
                      {selected && <span>✓</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {!hasAnySession && hasIpc() && (
            <button
              onClick={() => setShowConnectModal(true)}
              className="flex items-center gap-2 text-xs text-[#4d7cff] hover:underline"
            >
              <LogIn size={13} /> Sign in to your social accounts →
            </button>
          )}
        </CardContent>
      </Card>

      {/* Composer */}
      <Card>
        <CardHeader>
          <CardTitle>Compose</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Post type</Label>
              <Controller
                name="pubType"
                control={control}
                rules={{ required: true }}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={PubType.IMAGE_TEXT}>
                        Image + Caption
                      </SelectItem>
                      <SelectItem value={PubType.VIDEO}>Video</SelectItem>
                      <SelectItem value={PubType.ARTICLE}>
                        Article / Link
                      </SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            {(pubType === PubType.IMAGE_TEXT || pubType === PubType.VIDEO) && (
              <div className="space-y-1.5">
                <Label htmlFor="imageUrl" className="flex items-center gap-1.5">
                  <Image size={13} />
                  {pubType === PubType.VIDEO ? 'Video URL' : 'Image URL'}
                  <span className="font-normal text-ink-subtle text-xs">
                    (publicly accessible)
                  </span>
                </Label>
                <Input
                  id="imageUrl"
                  placeholder="https://your-site.com/image.jpg"
                  {...register('imageUrl')}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="body">Caption / Body</Label>
              <Textarea
                id="body"
                rows={5}
                placeholder="What do you want to say?"
                {...register('body', { required: 'Required' })}
              />
              {errors.body && (
                <p className="text-xs text-error">{errors.body.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="hashtags">Hashtags (space-separated)</Label>
              <Input
                id="hashtags"
                placeholder="#realestate #homebuying"
                {...register('hashtags')}
              />
            </div>

            {/* Publish now vs. schedule */}
            <div className="space-y-2">
              <Label>When</Label>
              <div className="flex gap-3">
                {(['now', 'later'] as const).map((mode) => (
                  <label
                    key={mode}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <input
                      type="radio"
                      value={mode}
                      {...register('scheduleMode')}
                      className="accent-accent"
                    />
                    <span className="text-sm text-ink-base capitalize">
                      {mode === 'now' ? 'Publish now' : 'Schedule for later'}
                    </span>
                  </label>
                ))}
              </div>

              {scheduleMode === 'later' && (
                <div className="space-y-1.5">
                  <Label
                    htmlFor="scheduledAt"
                    className="flex items-center gap-1.5"
                  >
                    <Clock size={13} />
                    Date &amp; time
                  </Label>
                  <Input
                    id="scheduledAt"
                    type="datetime-local"
                    min={minDateTime}
                    {...register('scheduledAt')}
                  />
                </div>
              )}
            </div>

            <Button
              type="submit"
              loading={submitting}
              disabled={!hasAnySession}
              className="w-full"
            >
              <Send size={16} />
              {scheduleMode === 'later' ? 'Schedule Post' : 'Publish Now'}
            </Button>

            {!hasAnySession && (
              <p className="text-xs text-center text-ink-muted">
                Connect at least one social account above to publish.
              </p>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
