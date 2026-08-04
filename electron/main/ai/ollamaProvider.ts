import OpenAI from 'openai';
import type {
  AIProvider,
  AIProviderName,
  GenerateImageOptions,
  GenerateTextOptions,
} from '@mas/types';
import { resolveMaxTokens, systemPrompt } from './prompt';
import type { OpenAILike } from './openaiProvider';

export const OLLAMA_DEFAULT_BASE_URL = 'http://localhost:11434';
export const OLLAMA_OPENAI_COMPAT_PATH = '/v1';

/** Single model entry from `GET /api/tags`. */
export interface OllamaModel {
  name: string;
  /** Bytes on disk. */
  size: number;
  modified_at: string;
}

/**
 * Discovery seam: production fetches from the real Ollama daemon; tests inject
 * a stub that returns a fixed list without network I/O.
 */
export interface OllamaDiscoverer {
  listModels(baseUrl: string): Promise<OllamaModel[]>;
}

/**
 * Ollama provider — runs 100% locally. OpenAI-compatible chat endpoint lives at
 * `{baseUrl}/v1`. No API key required. Image generation not supported.
 *
 * Inject an OpenAILike client (+ optionally an OllamaDiscoverer) in tests;
 * production builds use the real OpenAI SDK + a real fetch discoverer.
 */
export class OllamaProvider implements AIProvider {
  readonly name: AIProviderName = 'ollama';

  constructor(
    private readonly client: OpenAILike,
    private readonly model = 'llama3',
  ) {}

  async generateText(
    prompt: string,
    options?: GenerateTextOptions,
  ): Promise<string> {
    const res = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: resolveMaxTokens(options),
      messages: [
        { role: 'system', content: systemPrompt(options) },
        { role: 'user', content: prompt },
      ],
    });
    return (res.choices[0]?.message?.content ?? '').trim();
  }

  async generateImage(
    _prompt: string,
    _options?: GenerateImageOptions,
  ): Promise<string> {
    throw new Error(
      'Ollama does not support image generation. Use the OpenAI provider for images.',
    );
  }
}

/**
 * Real discoverer: GETs `{baseUrl}/api/tags` from the Ollama daemon.
 * Returns an empty list (not a throw) when Ollama is not running.
 */
export const realOllamaDiscoverer: OllamaDiscoverer = {
  async listModels(baseUrl: string): Promise<OllamaModel[]> {
    try {
      const res = await fetch(`${baseUrl}/api/tags`);
      if (!res.ok) return [];
      const json = (await res.json()) as { models?: OllamaModel[] };
      return json.models ?? [];
    } catch {
      return [];
    }
  },
};

/**
 * Create an OllamaProvider backed by the real OpenAI SDK pointed at the local
 * Ollama daemon's OpenAI-compatible endpoint. Not imported in unit tests.
 */
export function createOllamaProvider(
  baseUrl: string = OLLAMA_DEFAULT_BASE_URL,
  model?: string,
): OllamaProvider {
  const client = new OpenAI({
    apiKey: 'ollama', // Ollama ignores the key but the SDK requires a non-empty value
    baseURL: `${baseUrl}${OLLAMA_OPENAI_COMPAT_PATH}`,
  }) as unknown as OpenAILike;
  return new OllamaProvider(client, model);
}
