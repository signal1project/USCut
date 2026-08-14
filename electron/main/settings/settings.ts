import type { AIAuthMethod, AIProviderName, Platform } from '@mas/types';
import { AI_PROVIDER_INFO } from '@mas/types';
import { OLLAMA_DEFAULT_BASE_URL } from '../ai/ollamaProvider';
import type { OAuthClientConfig } from '../oauth/oauthService';

/** "Rachel" — one of ElevenLabs' own premade public voices, safe as a default. */
export const DEFAULT_ELEVENLABS_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';

// Key/value seam (electron-store in production; faked in tests). Distinct from
// the credential store — this holds non-secret-ish config (client ids, provider
// selection). API keys live here too but are only ever read in the main process.
export interface SettingsStore {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

export interface AIProviderSettings {
  name: AIProviderName;
  /** The authentication method used by this provider. Derived from AI_PROVIDER_INFO. */
  authMethod: AIAuthMethod;
  /**
   * API key for `api_key` and `oauth_key` providers.
   * Empty string for `local` providers (Ollama).
   */
  apiKey: string;
  /** Override base URL — used by Ollama when running on a non-default port/host. */
  baseUrl?: string;
  /** Active model slug override (e.g. "openai/gpt-4o", "llama3"). */
  model?: string;
}

const K = {
  oauth: (p: Platform) => `mas.settings.oauth.${p}`,
  activeProvider: 'mas.settings.ai.active',
  providerKey: (n: AIProviderName) => `mas.settings.ai.key.${n}`,
  providerModel: (n: AIProviderName) => `mas.settings.ai.model.${n}`,
  ollamaBaseUrl: 'mas.settings.ai.ollama.baseUrl',
  chatgptTokens: 'mas.settings.ai.chatgpt.tokens',
  elevenLabsKey: 'mas.settings.tts.elevenlabs.key',
  elevenLabsVoiceId: 'mas.settings.tts.elevenlabs.voiceId',
  brandKit: 'mas.settings.brand.kit',
  brandProfiles: 'mas.settings.brand.profiles',
  activeBrand: 'mas.settings.brand.active',
  platformBrands: 'mas.settings.brand.platformAssignments',
  competitors: 'mas.settings.competitors',
};

/** OAuth token bundle for ChatGPT sign-in (main-process only, like API keys). */
export interface ChatGPTTokenBundle {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

/**
 * Brand voice profile injected into every AI content brief so generated copy
 * stays on-brand across sessions and platforms.
 */
export interface BrandKit {
  brandName?: string;
  bio?: string;
  /** e.g. "confident, warm, no hype" */
  voice: string;
  /** e.g. "first-time homebuyers in Houston" */
  audience: string;
  /** Hashtags appended/preferred on every post. */
  hashtags: string[];
  /** Words/phrases the AI must never use. */
  bannedWords: string[];
  /** Optional signature/CTA line. */
  signature: string;
}

export interface BrandProfile extends BrandKit {
  id: string;
  name: string;
  bio: string;
}

/** Manually-tracked competitor for benchmarking. */
export interface CompetitorEntry {
  id: string;
  name: string;
  platform: string;
  handle: string;
  notes: string;
  /** Which company this competitor is benchmarked against. null = unassigned
   * (shown regardless of active company, same as an unassigned Page/account). */
  brandId?: string | null;
  /** Manual metric snapshots: { date, followers, engagementRate? } */
  snapshots: Array<{
    date: string;
    followers: number;
    engagementRate?: number;
  }>;
}

/** Typed accessor over persisted app settings used by the MAS runtime. */
export class Settings {
  constructor(private readonly store: SettingsStore) {}

  // ── Platform OAuth ─────────────────────────────────────────────────────────

  getPlatformOAuth(platform: Platform): OAuthClientConfig | null {
    const raw = this.store.get(K.oauth(platform));
    if (!raw || typeof raw !== 'object') return null;
    const cfg = raw as Partial<OAuthClientConfig>;
    if (!cfg.clientId || !cfg.redirectUri) return null;
    return {
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      redirectUri: cfg.redirectUri,
    };
  }

  setPlatformOAuth(platform: Platform, config: OAuthClientConfig): void {
    this.store.set(K.oauth(platform), config);
  }

  // ── AI Provider ────────────────────────────────────────────────────────────

  /**
   * Return the full settings for the currently active AI provider, or null if
   * no provider has been configured yet.
   */
  getActiveAIProvider(): AIProviderSettings | null {
    const name = this.store.get(K.activeProvider) as AIProviderName | undefined;
    if (!name) return null;
    return this.getProviderSettings(name);
  }

  /** Return settings for a specific provider (regardless of which is active). */
  getProviderSettings(name: AIProviderName): AIProviderSettings | null {
    const info = AI_PROVIDER_INFO[name];
    if (!info) return null;

    if (info.authMethod === 'local') {
      return {
        name,
        authMethod: info.authMethod,
        apiKey: '',
        baseUrl: this.getOllamaBaseUrl(),
        model: this.store.get(K.providerModel(name)) as string | undefined,
      };
    }

    // Token-based providers (ChatGPT): configured = a token bundle exists.
    // The provider refreshes/reads tokens itself; no apiKey is involved.
    if (info.authMethod === 'oauth_token') {
      if (!this.getChatGPTTokens()) return null;
      return {
        name,
        authMethod: info.authMethod,
        apiKey: '',
        model: this.store.get(K.providerModel(name)) as string | undefined,
      };
    }

    const apiKey = this.store.get(K.providerKey(name)) as string | undefined;
    if (!apiKey) return null;

    return {
      name,
      authMethod: info.authMethod,
      apiKey,
      model: this.store.get(K.providerModel(name)) as string | undefined,
    };
  }

  setAIProviderKey(name: AIProviderName, apiKey: string): void {
    this.store.set(K.providerKey(name), apiKey);
  }

  setAIProviderModel(name: AIProviderName, model: string): void {
    this.store.set(K.providerModel(name), model);
  }

  setActiveAIProvider(name: AIProviderName): void {
    this.store.set(K.activeProvider, name);
  }

  // ── ChatGPT sign-in tokens ─────────────────────────────────────────────────

  getChatGPTTokens(): ChatGPTTokenBundle | null {
    const raw = this.store.get(K.chatgptTokens);
    if (!raw || typeof raw !== 'object') return null;
    const t = raw as Partial<ChatGPTTokenBundle>;
    if (!t.accessToken) return null;
    return {
      accessToken: t.accessToken,
      refreshToken: t.refreshToken ?? '',
      expiresAt: typeof t.expiresAt === 'number' ? t.expiresAt : 0,
    };
  }

  setChatGPTTokens(tokens: ChatGPTTokenBundle): void {
    this.store.set(K.chatgptTokens, tokens);
  }

  clearChatGPTTokens(): void {
    this.store.set(K.chatgptTokens, null);
  }

  // ── Ollama-specific ────────────────────────────────────────────────────────

  getOllamaBaseUrl(): string {
    return (
      (this.store.get(K.ollamaBaseUrl) as string | undefined) ??
      OLLAMA_DEFAULT_BASE_URL
    );
  }

  setOllamaBaseUrl(url: string): void {
    this.store.set(K.ollamaBaseUrl, url);
  }

  // ── Voice Studio (TTS) ───────────────────────────────────────────────────────
  // Separate from the AIProviderName system above — ElevenLabs is TTS-only, not
  // a text-generation provider, and Voice Studio's default (Windows SAPI) needs
  // no key at all. This is purely an optional upgrade path.

  getElevenLabsKey(): string {
    return (this.store.get(K.elevenLabsKey) as string | undefined) ?? '';
  }

  setElevenLabsKey(apiKey: string): void {
    this.store.set(K.elevenLabsKey, apiKey);
  }

  getElevenLabsVoiceId(): string {
    return (
      (this.store.get(K.elevenLabsVoiceId) as string | undefined) ??
      DEFAULT_ELEVENLABS_VOICE_ID
    );
  }

  setElevenLabsVoiceId(voiceId: string): void {
    this.store.set(K.elevenLabsVoiceId, voiceId || DEFAULT_ELEVENLABS_VOICE_ID);
  }

  // ── Brand kit ──────────────────────────────────────────────────────────────

  getBrandKit(): BrandKit | null {
    const raw = this.store.get(K.brandKit);
    if (!raw || typeof raw !== 'object') return null;
    const kit = raw as Partial<BrandKit>;
    return {
      brandName: kit.brandName ?? '',
      bio: kit.bio ?? '',
      voice: kit.voice ?? '',
      audience: kit.audience ?? '',
      hashtags: Array.isArray(kit.hashtags) ? kit.hashtags : [],
      bannedWords: Array.isArray(kit.bannedWords) ? kit.bannedWords : [],
      signature: kit.signature ?? '',
    };
  }

  setBrandKit(kit: BrandKit): void {
    this.store.set(K.brandKit, kit);
  }

  getBrandProfiles(): BrandProfile[] {
    const raw = this.store.get(K.brandProfiles);
    if (Array.isArray(raw)) return raw as BrandProfile[];

    // Carry the original single Brand Kit forward as the first company.
    const legacy = this.getBrandKit();
    if (!legacy) return [];
    const migrated: BrandProfile = {
      id: 'default-brand',
      name: 'My Company',
      bio: '',
      ...legacy,
    };
    this.store.set(K.brandProfiles, [migrated]);
    return [migrated];
  }

  setBrandProfiles(profiles: BrandProfile[]): void {
    this.store.set(K.brandProfiles, profiles);
    // Keep older content-generation code working with the first brand.
    if (profiles[0]) {
      const { id: _id, name, bio, ...rules } = profiles[0];
      this.setBrandKit({ ...rules, brandName: name, bio });
    }
    // A deleted/renamed-away company can't stay the active scope.
    const activeId = this.store.get(K.activeBrand) as string | undefined;
    if (activeId && !profiles.some((p) => p.id === activeId)) {
      this.store.set(K.activeBrand, null);
    }
  }

  // ── Active company (whole-app scope switcher) ─────────────────────────────
  // Which BrandProfile the UI is currently "working as" — filters which
  // connected accounts/Pages are shown for posting and which brand voice gets
  // injected into AI content briefs. null/unset = "All companies" (no filter,
  // original single-company behavior).

  getActiveBrandId(): string | null {
    const id = this.store.get(K.activeBrand) as string | undefined;
    if (!id) return null;
    // Guard against a stale id from before a company was deleted.
    const exists = this.getBrandProfiles().some((p) => p.id === id);
    return exists ? id : null;
  }

  setActiveBrandId(id: string | null): void {
    this.store.set(K.activeBrand, id);
  }

  /** Resolve the brand kit for AI content briefs: active company if one is
   * chosen, otherwise the first company (matches the pre-switcher default). */
  getActiveBrandKit(): BrandKit | null {
    const profiles = this.getBrandProfiles();
    if (profiles.length === 0) return null;
    const activeId = this.getActiveBrandId();
    return profiles.find((p) => p.id === activeId) ?? profiles[0];
  }

  getPlatformBrandAssignments(): Partial<Record<Platform, string>> {
    const raw = this.store.get(K.platformBrands);
    return raw && typeof raw === 'object'
      ? (raw as Partial<Record<Platform, string>>)
      : {};
  }

  setPlatformBrandAssignment(platform: Platform, brandId: string | null): void {
    const assignments = this.getPlatformBrandAssignments();
    if (brandId) assignments[platform] = brandId;
    else delete assignments[platform];
    this.store.set(K.platformBrands, assignments);
  }

  // ── Competitor tracking (manual benchmarks) ────────────────────────────────

  getCompetitors(): CompetitorEntry[] {
    const raw = this.store.get(K.competitors);
    return Array.isArray(raw) ? (raw as CompetitorEntry[]) : [];
  }

  setCompetitors(entries: CompetitorEntry[]): void {
    this.store.set(K.competitors, entries);
  }

  // ── Image generation (always OpenAI) ──────────────────────────────────────

  /** Image generation always routes to OpenAI (the only provider that supports it). */
  getImageProvider(): AIProviderSettings | null {
    const apiKey = this.store.get(K.providerKey('openai')) as
      | string
      | undefined;
    if (!apiKey) return null;
    return { name: 'openai', authMethod: 'api_key', apiKey };
  }
}
