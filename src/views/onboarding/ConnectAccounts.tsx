/**
 * ConnectAccounts — social account connection modal.
 *
 * Primary path: "Sign In" button opens a BrowserWindow showing the real platform
 * login page. User logs in normally. Session cookies are persisted by Electron.
 * No developer app registration required.
 *
 * Secondary path: "Advanced" — expands the OAuth developer credentials form for
 * power users who want to use their own registered app.
 */

import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import {
  X,
  Check,
  ChevronRight,
  ExternalLink,
  Loader2,
  Link2,
  Copy,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  LogIn,
  LogOut,
  Building2,
} from 'lucide-react';
import { PLATFORMS, PLATFORM_CONFIG, type Platform } from '@mas/types';
import { ipc, hasIpc } from '@/lib/ipc';

// ── Platform branding ─────────────────────────────────────────────────────────

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

// ── Per-platform developer setup guide (for advanced / own-app users) ─────────

interface PlatformGuide {
  devConsoleUrl: string;
  devConsoleLabel: string;
  steps: string[];
  requiredScopes: string[];
  notes?: string;
}

const REDIRECT_URI = 'http://localhost:7766/callback';

const GUIDES: Record<Platform, PlatformGuide> = {
  facebook: {
    devConsoleUrl: 'https://developers.facebook.com/apps',
    devConsoleLabel: 'Facebook Developer Console',
    steps: [
      'Click "Create App" → choose "Business" type',
      'Add the "Facebook Login" product to your app',
      'In Facebook Login → Settings, add the redirect URI shown below to "Valid OAuth Redirect URIs"',
      'Go to App Settings → Basic and copy your App ID (Client ID) and App Secret',
    ],
    requiredScopes: [
      'pages_manage_posts',
      'pages_read_engagement',
      'pages_show_list',
    ],
    notes:
      'You need a Facebook Page (not personal profile) to publish via API.',
  },
  instagram: {
    devConsoleUrl: 'https://developers.facebook.com/apps',
    devConsoleLabel: 'Facebook Developer Console (Instagram)',
    steps: [
      'Use the same Facebook App (or create a new one)',
      'Add the "Instagram Graph API" product',
      'Add the redirect URI below to "Valid OAuth Redirect URIs"',
      'Your Instagram account must be a Professional account linked to a Facebook Page',
    ],
    requiredScopes: [
      'instagram_basic',
      'instagram_content_publish',
      'pages_show_list',
    ],
  },
  twitter: {
    devConsoleUrl: 'https://developer.twitter.com/en/portal/apps/new',
    devConsoleLabel: 'Twitter/X Developer Portal',
    steps: [
      'Create a Project and App',
      'Set "App permissions" to "Read and Write"',
      'Enable OAuth 2.0, set Type to "Web App", add redirect URI below',
      'Copy your OAuth 2.0 Client ID',
    ],
    requiredScopes: [
      'tweet.read',
      'tweet.write',
      'users.read',
      'offline.access',
    ],
    notes: 'Twitter uses PKCE — no Client Secret required.',
  },
  threads: {
    devConsoleUrl: 'https://developers.facebook.com/apps',
    devConsoleLabel: 'Meta Developer Console (Threads)',
    steps: [
      'Create a Meta App and add the "Threads API" product',
      'Under Threads API → Settings, add the redirect URI below',
      'Copy your App ID (Client ID)',
    ],
    requiredScopes: ['threads_basic', 'threads_content_publish'],
  },
  pinterest: {
    devConsoleUrl: 'https://developers.pinterest.com/apps/',
    devConsoleLabel: 'Pinterest Developer Portal',
    steps: [
      'Create a new app at developers.pinterest.com',
      'Add the redirect URI below',
      'Request "Read boards", "Read Pins", "Write Pins" permissions',
      'Copy your App ID and App Secret Key',
    ],
    requiredScopes: ['boards:read', 'pins:read', 'pins:write'],
  },
  youtube: {
    devConsoleUrl: 'https://console.developers.google.com/apis/credentials',
    devConsoleLabel: 'Google Cloud Console',
    steps: [
      'Create/select a project, enable "YouTube Data API v3"',
      'Create OAuth 2.0 Client ID → Web application',
      'Add redirect URI below',
      'Copy Client ID and Client Secret',
    ],
    requiredScopes: ['https://www.googleapis.com/auth/youtube.upload'],
    notes:
      'YouTube requires app review for production. Up to 100 test users while pending.',
  },
  tiktok: {
    devConsoleUrl: 'https://developers.tiktok.com/apps',
    devConsoleLabel: 'TikTok Developer Portal',
    steps: [
      'Create app at developers.tiktok.com',
      'Add "Content Posting API" and "Login Kit" products',
      'Add redirect URI below, submit for review',
      'Copy Client Key and Client Secret',
    ],
    requiredScopes: ['user.info.basic', 'video.publish', 'video.upload'],
    notes: 'TikTok requires dev approval before live posting.',
  },
  linkedin: {
    devConsoleUrl: 'https://www.linkedin.com/developers/apps/new',
    devConsoleLabel: 'LinkedIn Developer Portal',
    steps: [
      'Create a new app at linkedin.com/developers',
      'Add redirect URI below under Auth tab',
      'Request "Share on LinkedIn" and "Sign In with LinkedIn" products',
      'Copy Client ID and Client Secret from Auth tab',
    ],
    requiredScopes: ['w_member_social', 'r_basicprofile'],
    notes: 'LinkedIn requires product access approval.',
  },
};

// ── Component state ───────────────────────────────────────────────────────────

interface PlatformState {
  loggedIn: boolean;
  checking: boolean;
  signingIn: boolean;
  showAdvanced: boolean;
  clientId: string;
  clientSecret: string;
  authUrl: string;
  authState: string;
  codeVerifier?: string;
  redirectUrl: string;
  accountName: string;
  externalId: string;
  oauthBusy: boolean;
  oauthStage: 'idle' | 'authorize';
  guideOpen: boolean;
}

const blankState = (): PlatformState => ({
  loggedIn: false,
  checking: true,
  signingIn: false,
  showAdvanced: false,
  clientId: '',
  clientSecret: '',
  authUrl: '',
  authState: '',
  redirectUrl: '',
  accountName: '',
  externalId: '',
  oauthBusy: false,
  oauthStage: 'idle',
  guideOpen: false,
});

const inputCls =
  'w-full bg-[#0c0c0f] text-xs text-ink-strong rounded-md px-2.5 py-2 border border-[#26262d] focus:outline-none focus:border-[#4d7cff] transition-colors placeholder:text-[#4a4a55]';

// ── Main component ────────────────────────────────────────────────────────────

const ConnectAccounts: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [states, setStates] = useState<Record<string, PlatformState>>(() =>
    Object.fromEntries(PLATFORMS.map((p) => [p, blankState()])),
  );
  const [copied, setCopied] = useState(false);
  const [brands, setBrands] = useState<Array<{ id: string; name: string }>>([]);
  const [platformBrands, setPlatformBrands] = useState<Record<string, string>>(
    {},
  );
  const [businessAccounts, setBusinessAccounts] = useState<
    Array<{
      id: string;
      platform: Platform;
      accountName: string;
      externalId: string;
      brandId: string | null;
    }>
  >([]);

  const patch = (p: Platform, d: Partial<PlatformState>) =>
    setStates((s) => ({ ...s, [p]: { ...s[p], ...d } }));

  useEffect(() => {
    if (!hasIpc()) {
      PLATFORMS.forEach((p) => patch(p, { checking: false }));
      return;
    }
    PLATFORMS.forEach(async (p) => {
      try {
        const res = (await ipc.invoke('mas:social:session-status', p)) as {
          loggedIn: boolean;
        };
        patch(p, { loggedIn: res.loggedIn, checking: false });
      } catch {
        patch(p, { checking: false });
      }
    });
    Promise.all([
      ipc.invoke('mas:brands:list'),
      ipc.invoke('mas:brands:platform-assignments'),
      ipc.invoke('mas:accounts:list'),
    ])
      .then(([brandList, assignments, accounts]) => {
        setBrands(brandList as Array<{ id: string; name: string }>);
        setPlatformBrands((assignments ?? {}) as Record<string, string>);
        setBusinessAccounts(accounts as typeof businessAccounts);
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const assignPlatformBrand = async (platform: Platform, brandId: string) => {
    setPlatformBrands((current) => ({ ...current, [platform]: brandId }));
    await ipc.invoke('mas:brands:assign-platform', platform, brandId || null);
    toast.success(
      `Brand assignment saved for ${PLATFORM_CONFIG[platform].label}`,
    );
  };

  const assignAccountBrand = async (accountId: string, brandId: string) => {
    setBusinessAccounts((current) =>
      current.map((account) =>
        account.id === accountId
          ? { ...account, brandId: brandId || null }
          : account,
      ),
    );
    await ipc.invoke('mas:accounts:assign-brand', accountId, brandId || null);
    toast.success('Business page brand assignment saved');
  };

  const signIn = async (p: Platform) => {
    if (!hasIpc()) {
      toast.error('Requires the desktop app');
      return;
    }
    patch(p, { signingIn: true });
    try {
      await ipc.invoke('mas:social:open-login', p);
      const res = (await ipc.invoke('mas:social:session-status', p)) as {
        loggedIn: boolean;
      };
      patch(p, { loggedIn: res.loggedIn, signingIn: false });
      if (res.loggedIn)
        toast.success(`Connected to ${PLATFORM_CONFIG[p].label} ✓`);
      else toast.info('Window closed — try signing in again when ready.');
    } catch (e) {
      patch(p, { signingIn: false });
      toast.error(`Could not open login: ${(e as Error).message}`);
    }
  };

  const logOut = async (p: Platform) => {
    try {
      await ipc.invoke('mas:social:logout', p);
      patch(p, { loggedIn: false });
      toast.success(`Disconnected from ${PLATFORM_CONFIG[p].label}`);
    } catch (e) {
      toast.error(`Logout failed: ${(e as Error).message}`);
    }
  };

  const getAuthUrl = async (p: Platform) => {
    const s = states[p];
    if (!s.clientId.trim()) {
      toast.error('Client ID is required');
      return;
    }
    patch(p, { oauthBusy: true });
    try {
      await ipc.invoke('mas:settings:set-oauth', p, {
        clientId: s.clientId,
        clientSecret: s.clientSecret || undefined,
        redirectUri: REDIRECT_URI,
      });
      const req = (await ipc.invoke('mas:oauth:authorize-url', p)) as
        | { url: string; state: string; codeVerifier?: string }
        | undefined;
      if (!req?.url) throw new Error('No authorize URL returned');
      patch(p, {
        oauthStage: 'authorize',
        authUrl: req.url,
        authState: req.state,
        codeVerifier: req.codeVerifier,
        oauthBusy: false,
      });
    } catch (e) {
      patch(p, { oauthBusy: false });
      toast.error(`OAuth start failed: ${(e as Error).message}`);
    }
  };

  const completeOAuth = async (p: Platform) => {
    const s = states[p];
    if (
      !s.redirectUrl.trim() ||
      !s.accountName.trim() ||
      !s.externalId.trim()
    ) {
      toast.error('Account name, ID, and redirect URL are all required');
      return;
    }
    patch(p, { oauthBusy: true });
    try {
      await ipc.invoke('mas:oauth:complete', {
        platform: p,
        redirectUrl: s.redirectUrl,
        expectedState: s.authState,
        codeVerifier: s.codeVerifier,
        accountName: s.accountName,
        externalId: s.externalId,
        brandId: platformBrands[p] || null,
      });
      const refreshed = await ipc.invoke('mas:accounts:list');
      setBusinessAccounts(refreshed as typeof businessAccounts);
      patch(p, {
        oauthBusy: false,
        loggedIn: true,
        showAdvanced: false,
        oauthStage: 'idle',
      });
      toast.success(`✓ Connected: ${s.accountName}`);
    } catch (e) {
      patch(p, { oauthBusy: false });
      toast.error(`Connection failed: ${(e as Error).message}`);
    }
  };

  const copyRedirect = () => {
    navigator.clipboard.writeText(REDIRECT_URI).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] flex flex-col bg-[#161619] border border-[#2a2a31] rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#202027]">
          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#1d2540] text-[#7ba0ff]">
              <Link2 size={16} />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-ink-strong">
                Connect Social Accounts
              </h2>
              <p className="text-[11px] text-ink-muted">
                Sign in normally — a browser window opens for each platform.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-ink-muted hover:text-ink-strong hover:bg-[#26262d] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {!hasIpc() && (
          <div className="px-5 py-2 bg-[#3a2a10] text-[#e0a93a] text-[11px] flex items-center gap-1.5">
            <AlertCircle size={11} /> Running in browser preview — connecting
            accounts requires the desktop app.
          </div>
        )}

        {/* Platform list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {businessAccounts.length > 0 && (
            <div className="rounded-xl border border-[#2a3560] bg-[#151927] p-3 mb-3">
              <div className="flex items-center gap-2 mb-2">
                <Building2 size={14} className="text-[#7ba0ff]" />
                <div>
                  <p className="text-xs font-semibold text-ink-strong">
                    Connected Business Pages
                  </p>
                  <p className="text-[10px] text-ink-muted">
                    Choose which saved company owns each page or account.
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                {businessAccounts.map((account) => (
                  <div
                    key={account.id}
                    className="flex items-center gap-3 rounded-md bg-[#0f111b] px-3 py-2"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-ink-strong truncate">
                        {account.accountName}
                      </p>
                      <p className="text-[10px] text-ink-muted capitalize">
                        {account.platform} · {account.externalId}
                      </p>
                    </div>
                    <select
                      value={account.brandId ?? ''}
                      onChange={(e) =>
                        void assignAccountBrand(account.id, e.target.value)
                      }
                      className="w-44 bg-[#171923] border border-[#303443] rounded-md px-2 py-1.5 text-[11px] text-ink-strong focus:outline-none focus:border-[#4d7cff]"
                    >
                      <option value="">Choose company…</option>
                      {brands.map((brand) => (
                        <option key={brand.id} value={brand.id}>
                          {brand.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}
          {PLATFORMS.map((p) => {
            const cfg = PLATFORM_CONFIG[p];
            const guide = GUIDES[p];
            const s = states[p];

            return (
              <div
                key={p}
                className="rounded-xl border border-[#202027] bg-[#1a1a1f] overflow-hidden"
              >
                {/* Row */}
                <div className="flex items-center gap-3 px-3.5 py-3">
                  <span
                    className="flex items-center justify-center w-9 h-9 rounded-lg text-xs font-bold text-white shrink-0"
                    style={{ background: PLATFORM_COLOR[p] ?? '#4d7cff' }}
                  >
                    {cfg.label[0]}
                  </span>

                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-ink-strong">
                      {cfg.label}
                    </p>
                    <p className="text-[10px] text-ink-muted">
                      {s.checking
                        ? 'Checking session…'
                        : s.loggedIn
                          ? '✓ Signed in'
                          : 'Not connected'}
                    </p>
                  </div>

                  {s.loggedIn && (
                    <select
                      value={platformBrands[p] ?? ''}
                      onChange={(e) =>
                        void assignPlatformBrand(p, e.target.value)
                      }
                      className="w-36 bg-[#101013] border border-[#303039] rounded-md px-2 py-1.5 text-[10px] text-ink-strong focus:outline-none focus:border-[#4d7cff]"
                      title={`Company represented by this ${cfg.label} session`}
                    >
                      <option value="">Choose company…</option>
                      {brands.map((brand) => (
                        <option key={brand.id} value={brand.id}>
                          {brand.name}
                        </option>
                      ))}
                    </select>
                  )}

                  <div className="flex items-center gap-1.5">
                    {s.loggedIn ? (
                      <>
                        <span className="flex items-center gap-1 text-[11px] text-[#22c55e] font-medium">
                          <Check size={12} /> Connected
                        </span>
                        <button
                          onClick={() => void logOut(p)}
                          className="flex items-center gap-1 text-[10px] text-[#71717f] hover:text-[#c8c8d2] px-2 py-1.5 rounded-md hover:bg-[#26262d] transition-colors"
                        >
                          <LogOut size={10} /> Disconnect
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => void signIn(p)}
                          disabled={s.signingIn || s.checking}
                          className="flex items-center gap-1.5 text-[11px] font-semibold bg-[#4d7cff] hover:bg-[#3d6cf0] disabled:opacity-50 text-white rounded-md px-3 py-1.5 transition-colors"
                        >
                          {s.signingIn ? (
                            <Loader2 size={11} className="animate-spin" />
                          ) : (
                            <LogIn size={11} />
                          )}
                          Sign In
                        </button>
                        <button
                          onClick={() =>
                            patch(p, { showAdvanced: !s.showAdvanced })
                          }
                          className="flex items-center gap-1 text-[10px] text-[#71717f] hover:text-[#c8c8d2] px-2 py-1.5 rounded-md hover:bg-[#26262d] transition-colors"
                        >
                          {s.showAdvanced ? (
                            <ChevronUp size={10} />
                          ) : (
                            <ChevronDown size={10} />
                          )}
                          API
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Hint under unsigned row */}
                {!s.loggedIn && !s.showAdvanced && (
                  <p className="px-3.5 pb-3 text-[10px] text-ink-muted">
                    Click <strong>Sign In</strong> → {cfg.label} opens in a
                    window → log in normally → close when done.
                  </p>
                )}

                {/* Advanced: own developer app */}
                {!s.loggedIn && s.showAdvanced && (
                  <div className="px-3.5 pb-3.5 pt-1 border-t border-[#202027] space-y-3">
                    <p className="text-[10px] text-[#e0a93a]">
                      Advanced: use your own {cfg.label} developer app (requires
                      registering at their developer portal).
                    </p>

                    {/* Redirect URI */}
                    <div>
                      <p className="text-[10px] text-[#8aa6ff] mb-1">
                        Redirect URI for your app:
                      </p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 text-[11px] text-[#c8d8ff] bg-[#0c1025] rounded px-2 py-1.5 border border-[#2a3560] font-mono">
                          {REDIRECT_URI}
                        </code>
                        <button
                          onClick={copyRedirect}
                          className="flex items-center gap-1 text-[10px] px-2 py-1.5 rounded bg-[#1d2540] hover:bg-[#26306a] text-[#7ba0ff] transition-colors"
                        >
                          <Copy size={10} /> {copied ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                    </div>

                    {/* Setup guide toggle */}
                    <button
                      onClick={() => patch(p, { guideOpen: !s.guideOpen })}
                      className="flex items-center gap-1 text-[10px] text-[#7ba0ff] hover:text-[#aac0ff] transition-colors"
                    >
                      {s.guideOpen ? (
                        <ChevronUp size={10} />
                      ) : (
                        <ChevronDown size={10} />
                      )}
                      How to create a {cfg.label} developer app
                    </button>
                    {s.guideOpen && (
                      <div className="space-y-2">
                        <ol className="space-y-1">
                          {guide.steps.map((step, i) => (
                            <li
                              key={i}
                              className="flex gap-2 text-[10px] text-ink-muted"
                            >
                              <span className="shrink-0 text-[#4d7cff] font-semibold">
                                {i + 1}.
                              </span>
                              <span>{step}</span>
                            </li>
                          ))}
                        </ol>
                        {guide.notes && (
                          <p className="text-[10px] text-[#e0a93a] bg-[#2a200a] border border-[#4a3a18] rounded px-2 py-1.5">
                            {guide.notes}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-1">
                          {guide.requiredScopes.map((scope) => (
                            <code
                              key={scope}
                              className="text-[9px] bg-[#1a1f35] text-[#8aa6ff] border border-[#2a3560] rounded px-1.5 py-0.5"
                            >
                              {scope}
                            </code>
                          ))}
                        </div>
                        <button
                          onClick={() =>
                            window.open(
                              guide.devConsoleUrl,
                              '_blank',
                              'noopener',
                            )
                          }
                          className="flex items-center gap-1 text-[10px] font-medium bg-[#26262d] hover:bg-[#303039] text-ink-base rounded-md px-2.5 py-1.5 transition-colors"
                        >
                          <ExternalLink size={10} /> Open{' '}
                          {guide.devConsoleLabel}
                        </button>
                      </div>
                    )}

                    {/* Credentials */}
                    {s.oauthStage === 'idle' && (
                      <div className="space-y-2">
                        <input
                          className={inputCls}
                          placeholder="Client ID *"
                          value={s.clientId}
                          onChange={(e) =>
                            patch(p, { clientId: e.target.value })
                          }
                        />
                        <input
                          className={inputCls}
                          type="password"
                          placeholder="Client Secret (optional for PKCE)"
                          value={s.clientSecret}
                          onChange={(e) =>
                            patch(p, { clientSecret: e.target.value })
                          }
                        />
                        <button
                          onClick={() => void getAuthUrl(p)}
                          disabled={s.oauthBusy}
                          className="w-full flex items-center justify-center gap-2 bg-[#26262d] hover:bg-[#303039] disabled:opacity-50 text-ink-base text-xs font-medium rounded-md py-2 transition-colors"
                        >
                          {s.oauthBusy ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <>
                              Get authorize link <ChevronRight size={13} />
                            </>
                          )}
                        </button>
                      </div>
                    )}

                    {s.oauthStage === 'authorize' && (
                      <div className="space-y-2">
                        <button
                          onClick={() =>
                            window.open(s.authUrl, '_blank', 'noopener')
                          }
                          className="w-full flex items-center justify-center gap-2 bg-[#1d2540] hover:bg-[#243056] text-[#8aa6ff] text-xs font-medium rounded-md py-2 transition-colors"
                        >
                          <ExternalLink size={12} /> Open {cfg.label}{' '}
                          authorization →
                        </button>
                        <input
                          className={inputCls}
                          placeholder={`${REDIRECT_URI}?code=…`}
                          value={s.redirectUrl}
                          onChange={(e) =>
                            patch(p, { redirectUrl: e.target.value })
                          }
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            className={inputCls}
                            placeholder="Account name"
                            value={s.accountName}
                            onChange={(e) =>
                              patch(p, { accountName: e.target.value })
                            }
                          />
                          <input
                            className={inputCls}
                            placeholder="Account / page ID"
                            value={s.externalId}
                            onChange={(e) =>
                              patch(p, { externalId: e.target.value })
                            }
                          />
                        </div>
                        <select
                          value={platformBrands[p] ?? ''}
                          onChange={(e) =>
                            setPlatformBrands((current) => ({
                              ...current,
                              [p]: e.target.value,
                            }))
                          }
                          className={inputCls}
                        >
                          <option value="">
                            Choose company for this page…
                          </option>
                          {brands.map((brand) => (
                            <option key={brand.id} value={brand.id}>
                              {brand.name}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => void completeOAuth(p)}
                          disabled={s.oauthBusy}
                          className="w-full flex items-center justify-center gap-2 bg-[#22c55e] hover:bg-[#1faa52] disabled:opacity-50 text-[#06210f] text-xs font-semibold rounded-md py-2 transition-colors"
                        >
                          {s.oauthBusy ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <>
                              Finish connecting <Check size={13} />
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="px-5 py-3 border-t border-[#202027] flex items-center justify-between">
          <p className="text-[10px] text-ink-subtle">
            Sessions stored locally in Electron — credentials never leave this
            machine.
          </p>
          <button
            onClick={onClose}
            className="text-xs font-medium text-ink-base hover:text-ink-strong px-3 py-1.5 rounded-md hover:bg-[#26262d] transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConnectAccounts;
