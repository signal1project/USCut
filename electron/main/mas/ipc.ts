import { ipcMain, BrowserWindow } from 'electron';
import type { DataSource } from 'typeorm';
import {
  AccountStatus,
  AuditAction,
  type AIProviderName,
  type Platform,
} from '@mas/types';
import { AI_PROVIDER_INFO } from '@mas/types';
import { ConnectedAccountModel } from '../../db/models/mas/connectedAccount';
import { AuditLogModel } from '../../db/models/mas/auditLog';
import { CredentialManager } from '../credentials/credentialManager';
import { createOAuthService } from '../oauth';
import type { OAuthClientConfig } from '../oauth/oauthService';
import { Settings } from '../settings/settings';
import type { BrandProfile } from '../settings/settings';
import {
  runOpenRouterOAuthFlow,
  openOllamaInstallPage,
} from '../ai/openRouterOAuth';
import { runChatGPTSignIn } from '../ai/chatgptAuth';
import { realOllamaDiscoverer } from '../ai/ollamaProvider';
import { detectFacebookPages } from '../adapters/webviewBridge';

export interface MasIpcDeps {
  dataSource: DataSource;
  settings: Settings;
  credentials: CredentialManager;
}

/**
 * IPC surface for onboarding/settings: configure OAuth client apps + AI keys,
 * begin an OAuth authorize flow, and complete it (token exchange → encrypted
 * storage → ConnectedAccount row). Secrets never travel back to the renderer.
 */
export function registerMasIpc(deps: MasIpcDeps): void {
  const { dataSource, settings, credentials } = deps;
  const oauth = createOAuthService(credentials);

  // ── AI provider settings ───────────────────────────────────────────────────

  ipcMain.handle(
    'mas:settings:set-ai-key',
    (_e, name: AIProviderName, key: string) => {
      settings.setAIProviderKey(name, key);
      // Auto-activate this provider when a key is saved (unless one is already active).
      const current = settings.getActiveAIProvider();
      if (!current) settings.setActiveAIProvider(name);
      return { ok: true };
    },
  );

  ipcMain.handle(
    'mas:settings:set-active-provider',
    (_e, name: AIProviderName) => {
      settings.setActiveAIProvider(name);
      return { ok: true };
    },
  );

  ipcMain.handle(
    'mas:settings:set-ai-model',
    (_e, name: AIProviderName, model: string) => {
      settings.setAIProviderModel(name, model);
      return { ok: true };
    },
  );

  ipcMain.handle(
    'mas:settings:set-oauth',
    (_e, platform: Platform, config: OAuthClientConfig) => {
      settings.setPlatformOAuth(platform, config);
      return { ok: true };
    },
  );

  // ── Brand kit ──────────────────────────────────────────────────────────────

  ipcMain.handle('mas:settings:get-brand-kit', () => settings.getBrandKit());

  ipcMain.handle('mas:brands:list', () => settings.getBrandProfiles());

  ipcMain.handle('mas:brands:save', (_e, profile: BrandProfile) => {
    const profiles = settings.getBrandProfiles();
    const index = profiles.findIndex((item) => item.id === profile.id);
    if (index >= 0) profiles[index] = profile;
    else profiles.push(profile);
    settings.setBrandProfiles(profiles);
    return profiles;
  });

  ipcMain.handle('mas:brands:delete', (_e, brandId: string) => {
    const profiles = settings
      .getBrandProfiles()
      .filter((item) => item.id !== brandId);
    settings.setBrandProfiles(profiles);
    return profiles;
  });

  ipcMain.handle('mas:brands:platform-assignments', () =>
    settings.getPlatformBrandAssignments(),
  );

  ipcMain.handle(
    'mas:brands:assign-platform',
    (_e, platform: Platform, brandId: string | null) => {
      settings.setPlatformBrandAssignment(platform, brandId);
      return { ok: true };
    },
  );

  ipcMain.handle(
    'mas:settings:set-brand-kit',
    (
      _e,
      kit: {
        voice: string;
        audience: string;
        hashtags: string[];
        bannedWords: string[];
        signature: string;
      },
    ) => {
      settings.setBrandKit(kit);
      return { ok: true };
    },
  );

  /**
   * Return settings status visible to the UI — no secrets included.
   * Renderer uses this to show/hide "Connected" badges.
   */
  ipcMain.handle('mas:settings:status', () => {
    const active = settings.getActiveAIProvider();
    // Per-provider "is configured" flags.
    const providers = Object.values(AI_PROVIDER_INFO).map((info) => {
      const ps = settings.getProviderSettings(info.name);
      return {
        name: info.name,
        label: info.label,
        authMethod: info.authMethod,
        supportsImages: info.supportsImages,
        dashboardUrl: info.dashboardUrl,
        isConfigured: ps !== null,
        isActive: active?.name === info.name,
        model: ps?.model ?? null,
        ollamaBaseUrl:
          info.name === 'ollama' ? settings.getOllamaBaseUrl() : null,
      };
    });
    return {
      activeProvider: active?.name ?? null,
      imageReady: settings.getImageProvider() !== null,
      providers,
    };
  });

  // ── Ollama ─────────────────────────────────────────────────────────────────

  /**
   * Ping the local Ollama daemon and return the list of installed models.
   * Returns { running: false, models: [] } when the daemon is not detected.
   */
  ipcMain.handle('mas:ai:ollama-discover', async (_e, baseUrl?: string) => {
    const url = baseUrl ?? settings.getOllamaBaseUrl();
    const models = await realOllamaDiscoverer.listModels(url);
    return { running: models.length > 0, models };
  });

  ipcMain.handle('mas:ai:ollama-set-url', (_e, url: string) => {
    settings.setOllamaBaseUrl(url);
    return { ok: true };
  });

  /** Open the Ollama install page in the system browser. */
  ipcMain.handle('mas:ai:ollama-install-page', () => {
    openOllamaInstallPage();
    return { ok: true };
  });

  // ── Voice Studio (ElevenLabs TTS upgrade — optional, SAPI is the keyless default) ──

  ipcMain.handle('mas:tts:elevenlabs-get', () => ({
    configured: settings.getElevenLabsKey().length > 0,
    voiceId: settings.getElevenLabsVoiceId(),
  }));

  ipcMain.handle(
    'mas:tts:elevenlabs-set',
    (_e, apiKey: string, voiceId?: string) => {
      settings.setElevenLabsKey(apiKey.trim());
      if (voiceId !== undefined) settings.setElevenLabsVoiceId(voiceId.trim());
      return { ok: true };
    },
  );

  ipcMain.handle('mas:tts:elevenlabs-disconnect', () => {
    settings.setElevenLabsKey('');
    return { ok: true };
  });

  // ── OpenRouter OAuth ───────────────────────────────────────────────────────

  /**
   * Start the OpenRouter OAuth flow in a child BrowserWindow.
   * Resolves with the obtained API key and automatically saves it.
   * The renderer awaits this IPC call for the result.
   */
  ipcMain.handle('mas:ai:openrouter-oauth', async (event) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    if (!senderWin) throw new Error('Could not find the parent BrowserWindow.');

    const key = await runOpenRouterOAuthFlow(senderWin);
    settings.setAIProviderKey('openrouter', key);
    const current = settings.getActiveAIProvider();
    if (!current) settings.setActiveAIProvider('openrouter');

    return { ok: true };
  });

  // ── ChatGPT sign-in (OpenAI Codex OAuth — device-code flow) ────────────────

  /**
   * Run the "Sign in with ChatGPT" device-code flow. The user code is pushed
   * to the renderer via 'mas:ai:chatgpt-user-code' as soon as it's known (it
   * is also copied to the clipboard); this handler resolves only when the
   * whole flow completes (approved + tokens stored) or fails.
   */
  ipcMain.handle('mas:ai:chatgpt-oauth', async (event) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    if (!senderWin) throw new Error('Could not find the parent BrowserWindow.');

    await runChatGPTSignIn(senderWin, settings, (info) => {
      if (!event.sender.isDestroyed())
        event.sender.send('mas:ai:chatgpt-user-code', info);
    });

    const current = settings.getActiveAIProvider();
    if (!current) settings.setActiveAIProvider('chatgpt');
    return { ok: true };
  });

  /** Forget the stored ChatGPT tokens (sign out). */
  ipcMain.handle('mas:ai:chatgpt-disconnect', () => {
    settings.clearChatGPTTokens();
    return { ok: true };
  });

  // ── Social platform OAuth ──────────────────────────────────────────────────

  ipcMain.handle('mas:oauth:authorize-url', (_e, platform: Platform) => {
    const config = settings.getPlatformOAuth(platform);
    if (!config) throw new Error(`Configure the ${platform} OAuth app first.`);
    return oauth.buildAuthorizeUrl(platform, config);
  });

  /** List all connected accounts (no secrets — for the publish UI account picker). */
  ipcMain.handle('mas:accounts:list', async () => {
    const repo = dataSource.getRepository(ConnectedAccountModel);
    const accounts = await repo.find({
      order: { platform: 'ASC', accountName: 'ASC' },
    });
    return accounts.map((a) => ({
      id: a.id,
      platform: a.platform,
      accountName: a.accountName,
      externalId: a.externalId,
      status: a.status,
      brandId:
        typeof a.metadata?.brandId === 'string' ? a.metadata.brandId : null,
      // 'webview' = detected via the signed-in browser session, no OAuth
      // token — must post through mas:social:post-webview (pageId), never
      // through the API publish engine, which needs a real access token.
      source:
        typeof a.metadata?.source === 'string' ? a.metadata.source : 'oauth',
    }));
  });

  ipcMain.handle(
    'mas:accounts:assign-brand',
    async (_e, accountId: string, brandId: string | null) => {
      const repo = dataSource.getRepository(ConnectedAccountModel);
      const account = await repo.findOneByOrFail({ id: accountId });
      account.metadata = { ...account.metadata, brandId };
      if (!brandId) delete account.metadata.brandId;
      await repo.save(account);
      return { ok: true };
    },
  );

  /**
   * Scan the signed-in Facebook session for Pages the user manages and save
   * them as connected accounts (webview-based — no OAuth token). Lets each
   * Page get its own business-profile assignment instead of one company per
   * login session.
   */
  ipcMain.handle('mas:social:detect-pages', async (event) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    if (!senderWin) throw new Error('Could not find the parent BrowserWindow.');

    const pages = await detectFacebookPages(senderWin);
    const repo = dataSource.getRepository(ConnectedAccountModel);
    let created = 0;
    for (const page of pages) {
      const existing = await repo.findOne({
        where: { platform: 'facebook' as Platform, externalId: page.id },
      });
      if (existing) {
        existing.accountName = page.name;
        existing.status = AccountStatus.CONNECTED;
        existing.metadata = {
          ...existing.metadata,
          source: 'webview',
          pageUrl: page.url,
        };
        await repo.save(existing);
      } else {
        created += 1;
        const account = repo.create({
          platform: 'facebook' as Platform,
          accountName: page.name,
          externalId: page.id,
          status: AccountStatus.CONNECTED,
          credentialRef: 'webview-session',
          metadata: { source: 'webview', pageUrl: page.url },
        });
        await repo.save(account);
      }
    }
    return { found: pages.length, created };
  });

  ipcMain.handle(
    'mas:oauth:complete',
    async (
      _e,
      args: {
        platform: Platform;
        redirectUrl: string;
        expectedState: string;
        codeVerifier?: string;
        accountName: string;
        externalId: string;
        brandId?: string | null;
      },
    ) => {
      const config = settings.getPlatformOAuth(args.platform);
      if (!config)
        throw new Error(`Configure the ${args.platform} OAuth app first.`);

      const { code } = oauth.parseCallback(
        args.redirectUrl,
        args.expectedState,
      );
      const bundle = await oauth.exchangeCode(args.platform, config, {
        code,
        codeVerifier: args.codeVerifier,
      });

      const credentialRef = CredentialManager.refFor(
        args.platform,
        args.externalId,
      );
      credentials.save(credentialRef, bundle);

      const repo = dataSource.getRepository(ConnectedAccountModel);
      const account = await repo.save(
        repo.create({
          platform: args.platform,
          accountName: args.accountName,
          externalId: args.externalId,
          status: AccountStatus.CONNECTED,
          credentialRef,
          tokenExpiresAt: bundle.expiresAt,
          metadata: args.brandId ? { brandId: args.brandId } : {},
        }),
      );

      const auditRepo = dataSource.getRepository(AuditLogModel);
      await auditRepo.save(
        auditRepo.create({
          action: AuditAction.ACCOUNT_CONNECTED,
          entity: 'mas_connected_account',
          entityId: account.id,
          details: { platform: args.platform },
        }),
      );

      return {
        id: account.id,
        platform: account.platform,
        accountName: account.accountName,
      };
    },
  );
}
