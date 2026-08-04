import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Bot,
  Check,
  ChevronRight,
  Cpu,
  ExternalLink,
  KeyRound,
  Link2,
  Loader2,
  LogOut,
  MessageCircle,
  Mic,
  Palette,
  Rocket,
  Server,
  Share2,
  Zap,
} from 'lucide-react';
import type { AIProviderName } from '@mas/types';
import type { SettingsStatus } from '@mas/ui';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from '@/components/ui';
import { useMasIpc } from './useMasIpc';
import ConnectAccounts from '../onboarding/ConnectAccounts';

type ProviderStatus = SettingsStatus['providers'][number];

const PROVIDER_ICON: Record<string, React.ElementType> = {
  claude: Bot,
  openai: KeyRound,
  chatgpt: MessageCircle,
  openrouter: Zap,
  ollama: Cpu,
  groq: Zap,
};

function ProviderCard({
  p,
  onChanged,
}: {
  p: ProviderStatus;
  onChanged: () => void;
}) {
  const ipc = useMasIpc();
  const [busy, setBusy] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(p.model ?? '');
  const [ollamaUrl, setOllamaUrl] = useState(
    p.ollamaBaseUrl ?? 'http://localhost:11434',
  );
  const [chatgptCode, setChatgptCode] = useState<string | null>(null);

  useEffect(() => {
    if (p.name !== 'chatgpt') return;
    return ipc.onChatGPTUserCode((info) => setChatgptCode(info.userCode));
  }, [p.name, ipc]);

  const run = async (fn: () => Promise<unknown>, successMsg: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(successMsg);
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      setChatgptCode(null);
    }
  };

  const Icon = PROVIDER_ICON[p.name] ?? Bot;

  return (
    <div className="rounded-lg border border-border bg-surface-2 p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-1 text-accent">
          <Icon size={17} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-ink-strong">{p.label}</p>
            {p.isConfigured && (
              <Badge
                variant="outline"
                className="text-[10px] border-[#22c55e]/40 text-[#22c55e]"
              >
                <Check size={10} className="mr-0.5" /> Connected
              </Badge>
            )}
            {p.isActive && (
              <Badge className="text-[10px] bg-accent text-bg">Active</Badge>
            )}
          </div>
          <p className="text-xs text-ink-muted mt-0.5">
            {p.authMethod === 'oauth_token' &&
              'Sign in with your ChatGPT account — no API key.'}
            {p.authMethod === 'oauth_key' &&
              'Browser sign-in that issues a key automatically.'}
            {p.authMethod === 'api_key' &&
              'Paste an API key from the provider dashboard.'}
            {p.authMethod === 'local' &&
              'Runs on your machine — free and offline.'}
          </p>
        </div>
        <a
          href={p.dashboardUrl}
          target="_blank"
          rel="noreferrer"
          className="text-ink-muted hover:text-ink-base transition-colors shrink-0"
          title="Open provider dashboard"
        >
          <ExternalLink size={14} />
        </a>
      </div>

      <div className="mt-3 space-y-2">
        {/* Connect action per auth method */}
        {p.authMethod === 'oauth_token' &&
          (chatgptCode ? (
            <div className="rounded-lg bg-surface-1 border border-border p-3 text-center">
              <p className="text-xs text-ink-muted mb-1">
                Enter this code in the OpenAI window (already on your
                clipboard):
              </p>
              <p className="text-lg font-mono font-bold tracking-[0.3em] text-ink-strong select-all">
                {chatgptCode}
              </p>
              <p className="flex items-center justify-center gap-1.5 text-[11px] text-ink-muted mt-1.5">
                <Loader2 size={11} className="animate-spin" /> Waiting for
                approval…
              </p>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button
                size="sm"
                loading={busy}
                onClick={() =>
                  run(() => ipc.connectChatGPT(), 'ChatGPT connected')
                }
              >
                {p.isConfigured ? 'Re-connect ChatGPT' : 'Sign in with ChatGPT'}
                <ChevronRight size={13} />
              </Button>
              {p.isConfigured && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    run(() => ipc.disconnectChatGPT(), 'ChatGPT disconnected')
                  }
                >
                  <LogOut size={12} /> Disconnect
                </Button>
              )}
            </div>
          ))}

        {p.authMethod === 'oauth_key' && (
          <Button
            size="sm"
            loading={busy}
            onClick={() =>
              run(() => ipc.connectOpenRouter(), 'OpenRouter connected')
            }
          >
            {p.isConfigured
              ? 'Re-connect OpenRouter'
              : 'Sign in with OpenRouter'}
            <ChevronRight size={13} />
          </Button>
        )}

        {p.authMethod === 'api_key' && (
          <div className="flex gap-2">
            <Input
              type="password"
              placeholder={
                p.isConfigured
                  ? '••••••••  (saved — paste to replace)'
                  : 'Paste API key'
              }
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="text-xs flex-1"
            />
            <Button
              size="sm"
              disabled={!apiKey.trim() || busy}
              onClick={() =>
                run(async () => {
                  await ipc.setAIKey(p.name as AIProviderName, apiKey.trim());
                  setApiKey('');
                }, `${p.label} key saved`)
              }
            >
              Save key
            </Button>
          </div>
        )}

        {p.authMethod === 'local' && (
          <div className="flex gap-2">
            <Input
              placeholder="http://localhost:11434"
              value={ollamaUrl}
              onChange={(e) => setOllamaUrl(e.target.value)}
              className="text-xs flex-1"
            />
            <Button
              size="sm"
              loading={busy}
              onClick={() =>
                run(async () => {
                  await ipc.setOllamaUrl(ollamaUrl);
                  const result = await ipc.discoverOllama(ollamaUrl);
                  if (!result.running)
                    throw new Error(
                      'Ollama not reachable at that URL — is it running?',
                    );
                  return result;
                }, 'Ollama connected')
              }
            >
              Test & save
            </Button>
          </div>
        )}

        {/* Model override + set active */}
        <div className="flex gap-2 items-center">
          <Input
            placeholder="Model override (optional — provider default if empty)"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="text-xs flex-1"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={busy || model === (p.model ?? '')}
            onClick={() =>
              run(
                () => ipc.setAIModel(p.name as AIProviderName, model.trim()),
                'Model saved',
              )
            }
          >
            Save model
          </Button>
          {p.isConfigured && !p.isActive && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                run(
                  () => ipc.setActiveProvider(p.name as AIProviderName),
                  `${p.label} is now active`,
                )
              }
            >
              Set active
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function VoiceStudioCard(): React.ReactElement {
  const ipc = useMasIpc();
  const [status, setStatus] = useState<{
    configured: boolean;
    voiceId: string;
  } | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [voiceId, setVoiceId] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    void ipc
      .getElevenLabsStatus()
      .then((s) => {
        setStatus(s);
        setVoiceId(s.voiceId);
      })
      .catch(() => setStatus(null));
  }, [ipc]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const save = async () => {
    setBusy(true);
    try {
      await ipc.setElevenLabsKey(apiKey.trim(), voiceId.trim());
      setApiKey('');
      toast.success('ElevenLabs key saved');
      refresh();
    } catch {
      toast.error('Could not save the ElevenLabs key');
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await ipc.disconnectElevenLabs();
      toast.success(
        'ElevenLabs disconnected — Voice Studio uses Windows SAPI again',
      );
      refresh();
    } catch {
      toast.error('Could not disconnect');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Mic size={16} className="text-[#22c55e]" /> Voice Studio
        </CardTitle>
        <CardDescription>
          Windows speech synthesis works out of the box, no key needed. Add an
          ElevenLabs key for higher-quality, more natural voiceovers.
          {status?.configured ? ' ElevenLabs is active.' : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2.5">
        <div className="flex gap-2">
          <Input
            type="password"
            placeholder={
              status?.configured
                ? '••••••••  (saved — paste to replace)'
                : 'Paste ElevenLabs API key'
            }
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="text-xs flex-1"
          />
          <Button size="sm" disabled={!apiKey.trim() || busy} onClick={save}>
            Save key
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Voice ID (defaults to a premade ElevenLabs voice)"
            value={voiceId}
            onChange={(e) => setVoiceId(e.target.value)}
            className="text-xs flex-1"
          />
          {status?.configured && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={disconnect}
            >
              <LogOut size={12} /> Disconnect
            </Button>
          )}
        </div>
        <p className="text-[11px] text-ink-muted">
          Find voice IDs at{' '}
          <a
            href="https://elevenlabs.io/app/voice-library"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            elevenlabs.io/app/voice-library
          </a>
          . Billed by ElevenLabs per character — check their pricing before
          heavy use.
        </p>
      </CardContent>
    </Card>
  );
}

function BackgroundPrefsCard(): React.ReactElement {
  const [prefs, setPrefs] = useState<{
    keepInTray: boolean;
    launchAtLogin: boolean;
  } | null>(null);

  useEffect(() => {
    void window.ipcRenderer
      .invoke('app:get-background-prefs')
      .then((p) =>
        setPrefs(p as { keepInTray: boolean; launchAtLogin: boolean }),
      )
      .catch(() => setPrefs(null));
  }, []);

  const update = async (patch: Partial<NonNullable<typeof prefs>>) => {
    const next = {
      ...(prefs ?? { keepInTray: true, launchAtLogin: false }),
      ...patch,
    };
    setPrefs(next);
    await window.ipcRenderer.invoke('app:set-background-prefs', patch);
    toast.success('App behavior saved');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Rocket size={16} className="text-[#22c55e]" /> App Behavior
        </CardTitle>
        <CardDescription>
          Scheduled posts only publish while AICut is running — keep it in the
          tray so nothing gets missed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2.5">
        <label className="flex items-center gap-2.5 text-sm text-ink-base cursor-pointer">
          <input
            type="checkbox"
            checked={prefs?.keepInTray ?? true}
            onChange={(e) => void update({ keepInTray: e.target.checked })}
            className="accent-[#4d7cff]"
          />
          Keep running in the tray when the window is closed
        </label>
        <label className="flex items-center gap-2.5 text-sm text-ink-base cursor-pointer">
          <input
            type="checkbox"
            checked={prefs?.launchAtLogin ?? false}
            onChange={(e) => void update({ launchAtLogin: e.target.checked })}
            className="accent-[#4d7cff]"
          />
          Start AICut when Windows starts (hidden, in the tray)
        </label>
        <p className="text-[11px] text-ink-muted">
          Posts that came due while AICut was closed are caught up automatically
          at the next launch, with a desktop notification per result.
        </p>
      </CardContent>
    </Card>
  );
}

export default function SettingsPage(): React.ReactElement {
  const ipc = useMasIpc();
  const navigate = useNavigate();
  const [status, setStatus] = useState<SettingsStatus | null>(null);
  const [showAccounts, setShowAccounts] = useState(false);

  const refresh = useCallback(() => {
    void ipc
      .getSettingsStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, [ipc]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="mx-auto max-w-3xl p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-ink-strong tracking-tight">
          Settings
        </h1>
        <p className="text-sm text-ink-muted mt-1">
          Everything configurable in one place. New here? The{' '}
          <button
            className="text-accent hover:underline"
            onClick={() => navigate('/mas/onboarding')}
          >
            first-time setup guide
          </button>{' '}
          walks through the essentials step by step.
        </p>
      </div>

      {/* AI providers */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bot size={16} className="text-accent" /> AI Providers
          </CardTitle>
          <CardDescription>
            Powers caption generation, auto-edit, listing ads, and auto-clip
            picking.
            {status?.activeProvider
              ? ` Active provider: ${status.activeProvider}.`
              : ' No provider active yet — connect one below.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {status ? (
            status.providers.map((p) => (
              <ProviderCard key={p.name} p={p} onChanged={refresh} />
            ))
          ) : (
            <p className="text-xs text-ink-muted flex items-center gap-2">
              <Loader2 size={12} className="animate-spin" /> Loading provider
              status…
            </p>
          )}
          {status && (
            <p className="text-[11px] text-ink-muted">
              Image generation requires an OpenAI API key (
              {status.imageReady ? 'configured ✓' : 'not configured'}).
            </p>
          )}
        </CardContent>
      </Card>

      {/* Voice Studio (Windows SAPI keyless default + optional ElevenLabs upgrade) */}
      <VoiceStudioCard />

      {/* Social accounts */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Share2 size={16} className="text-[#22c55e]" /> Social Accounts
          </CardTitle>
          <CardDescription>
            Connect Facebook, Instagram, X, TikTok, YouTube, LinkedIn, Pinterest
            and Threads — sign in directly (like CapCut) or via developer-app
            OAuth for API features.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button size="sm" onClick={() => setShowAccounts(true)}>
            <Link2 size={13} /> Manage social accounts
          </Button>
        </CardContent>
      </Card>

      {/* Brand kit + setup guide shortcuts */}
      <div className="grid grid-cols-2 gap-4">
        <button
          onClick={() => navigate('/mas/brand')}
          className="text-left rounded-xl border border-border bg-surface-2 hover:border-accent/40 transition-colors p-4"
        >
          <Palette size={16} className="text-[#a78bfa] mb-2" />
          <p className="text-sm font-semibold text-ink-strong">Brand Kit</p>
          <p className="text-xs text-ink-muted mt-0.5">
            Voice, audience, hashtags, banned words — injected into every AI
            brief.
          </p>
        </button>
        <button
          onClick={() => navigate('/mas/onboarding')}
          className="text-left rounded-xl border border-border bg-surface-2 hover:border-accent/40 transition-colors p-4"
        >
          <Rocket size={16} className="text-[#4d7cff] mb-2" />
          <p className="text-sm font-semibold text-ink-strong">
            First-time setup guide
          </p>
          <p className="text-xs text-ink-muted mt-0.5">
            Guided walkthrough: AI provider → social account → done.
          </p>
        </button>
      </div>

      {/* App behavior (tray + login) */}
      <BackgroundPrefsCard />

      {/* Local integrations (read-only info) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Server size={16} className="text-[#e0a93a]" /> Local Integrations
          </CardTitle>
          <CardDescription>
            For agents and the listing-capture Chrome extension.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-xs text-ink-muted space-y-1.5">
          <p>
            <span className="text-ink-base font-medium">Agent bridge</span> —
            127.0.0.1:4255 (discovery:{' '}
            <code className="text-accent">
              %APPDATA%\aicuts\aicut-bridge.json
            </code>
            )
          </p>
          <p>
            <span className="text-ink-base font-medium">
              Listing capture server
            </span>{' '}
            — 127.0.0.1:7474 (Chrome extension target; load{' '}
            <code className="text-accent">dist-ext/</code> unpacked)
          </p>
          <p>
            <span className="text-ink-base font-medium">MAS API</span> — port +
            token in{' '}
            <code className="text-accent">%APPDATA%\aicuts\api-port.json</code>{' '}
            (rotates per launch)
          </p>
        </CardContent>
      </Card>

      {showAccounts && (
        <ConnectAccounts onClose={() => setShowAccounts(false)} />
      )}
    </div>
  );
}
