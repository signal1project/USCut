import React, { useState, useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { toast } from 'sonner';
import { Send, RefreshCw, Clock, Image, LogIn, Check } from 'lucide-react';
import { PubType, PLATFORMS, PLATFORM_CONFIG, type Platform } from '@mas/types';
import { PlatformBadge } from '@mas/ui';
import { useMasApi } from './useMasApi';
import { ipc, hasIpc } from '@/lib/ipc';
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
  const [submitting, setSubmitting] = useState(false);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  // Webview session status per platform
  const [webviewSessions, setWebviewSessions] = useState<
    Partial<Record<Platform, boolean>>
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
      if (list.length > 0 && selectedAccountIds.length === 0) {
        setSelectedAccountIds(list.map((a) => a.id));
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleAccount = (id: string) => {
    setSelectedAccountIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const toggleWebviewPlatform = (p: Platform) => {
    setSelectedWebviewPlatforms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
    );
  };

  const connectedPlatforms = PLATFORMS.filter((p) => webviewSessions[p]);
  const hasAnySession = connectedPlatforms.length > 0 || accounts.length > 0;

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
    if (webviewTargets.length === 0 && selectedAccountIds.length === 0) {
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

          {/* API-connected accounts (developer app OAuth) */}
          {accounts.length > 0 && (
            <div>
              <p className="text-[10px] text-ink-muted mb-2">
                API-connected accounts:
              </p>
              <div className="flex flex-wrap gap-2">
                {accounts.map((acc) => {
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
