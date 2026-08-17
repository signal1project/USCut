import { z } from 'zod';
import type { Platform } from './platforms';

/** Supported AI providers (user-configurable in Settings). */
export const AI_PROVIDERS = [
  'claude',
  'openai',
  'chatgpt',
  'openrouter',
  'ollama',
  'groq',
] as const;
export type AIProviderName = (typeof AI_PROVIDERS)[number];
export const aiProviderSchema = z.enum(AI_PROVIDERS);

/**
 * How credentials are stored/obtained for a provider.
 *   api_key     — user pastes a key they copied from the provider's dashboard
 *   oauth_key   — a redirect flow that yields an API key (OpenRouter)
 *   oauth_token — a sign-in flow that yields access+refresh tokens (ChatGPT);
 *                 no API key ever exists, tokens are refreshed in the main process
 *   local       — no auth; provider runs on localhost (Ollama)
 */
export type AIAuthMethod = 'api_key' | 'oauth_key' | 'oauth_token' | 'local';

/** Static metadata about each provider — display name, auth method, feature flags. */
export interface AIProviderInfo {
  name: AIProviderName;
  label: string;
  authMethod: AIAuthMethod;
  /** Whether this provider supports DALL-E-style image generation. */
  supportsImages: boolean;
  /** Homepage / dashboard URL shown in Settings. */
  dashboardUrl: string;
}

export const AI_PROVIDER_INFO: Record<AIProviderName, AIProviderInfo> = {
  claude: {
    name: 'claude',
    label: 'Anthropic Claude',
    authMethod: 'api_key',
    supportsImages: false,
    dashboardUrl: 'https://console.anthropic.com/settings/keys',
  },
  openai: {
    name: 'openai',
    label: 'OpenAI (API key)',
    authMethod: 'api_key',
    supportsImages: true,
    dashboardUrl: 'https://platform.openai.com/api-keys',
  },
  chatgpt: {
    name: 'chatgpt',
    label: 'OpenAI (ChatGPT sign-in)',
    authMethod: 'oauth_token',
    supportsImages: false,
    dashboardUrl: 'https://chatgpt.com',
  },
  openrouter: {
    name: 'openrouter',
    label: 'OpenRouter',
    authMethod: 'oauth_key',
    supportsImages: false,
    dashboardUrl: 'https://openrouter.ai/keys',
  },
  ollama: {
    name: 'ollama',
    label: 'Ollama (local)',
    authMethod: 'local',
    supportsImages: false,
    dashboardUrl: 'https://ollama.com',
  },
  groq: {
    name: 'groq',
    label: 'Groq',
    authMethod: 'api_key',
    supportsImages: false,
    dashboardUrl: 'https://console.groq.com/keys',
  },
};

export interface GenerateTextOptions {
  /** Target platform — used to enforce length and shape the prompt. */
  platform?: Platform;
  tone?: string;
  maxTokens?: number;
}

export interface GenerateImageOptions {
  width?: number;
  height?: number;
}

export interface AnalyzeFramesInput {
  /** Seconds from clip/video start — matches how the frame was sampled. */
  timestampSeconds: number;
  /** Raw base64-encoded JPEG bytes (no data: URI prefix). */
  base64Jpeg: string;
}

/** Abstraction every AI provider implements. Swapped via config, not code. */
export interface AIProvider {
  readonly name: AIProviderName;
  generateText(prompt: string, options?: GenerateTextOptions): Promise<string>;
  generateImage(
    prompt: string,
    options?: GenerateImageOptions,
  ): Promise<string>;
  /**
   * Vision analysis over one or more sampled frames — used for subject
   * tracking (locate the on-screen subject per frame) and genre-agnostic
   * highlight detection (visually-driven moments a transcript alone can't
   * surface). Optional: only vision-capable providers implement it: callers
   * must check for its presence before use and fall back gracefully
   * (fixed-crop reframe, transcript-only curation) when absent.
   */
  analyzeFrames?(
    frames: AnalyzeFramesInput[],
    prompt: string,
  ): Promise<string>;
}

export const generateContentRequestSchema = z.object({
  brief: z.string().min(1),
  platforms: z.array(z.string()).min(1),
  tone: z.string().optional(),
});
export type GenerateContentRequest = z.infer<
  typeof generateContentRequestSchema
>;
