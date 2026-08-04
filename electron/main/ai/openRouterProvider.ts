import OpenAI from 'openai';
import type {
  AIProvider,
  AIProviderName,
  GenerateImageOptions,
  GenerateTextOptions,
} from '@mas/types';
import { resolveMaxTokens, systemPrompt } from './prompt';
import type { OpenAILike } from './openaiProvider';

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * OpenRouter provider — OpenAI-compatible API that routes to 100+ models.
 * Uses an API key obtained via the OAuth key-callback flow.
 * Inject an OpenAILike client in tests; production uses the real OpenAI SDK
 * pointed at the OpenRouter base URL.
 */
export class OpenRouterProvider implements AIProvider {
  readonly name: AIProviderName = 'openrouter';

  constructor(
    private readonly client: OpenAILike,
    /** Full model slug, e.g. "openai/gpt-4o" or "anthropic/claude-3-5-sonnet". */
    private readonly textModel = 'openai/gpt-4o',
  ) {}

  async generateText(
    prompt: string,
    options?: GenerateTextOptions,
  ): Promise<string> {
    const res = await this.client.chat.completions.create({
      model: this.textModel,
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
      'OpenRouter does not support image generation. Use the OpenAI provider for images.',
    );
  }
}

/**
 * Create an OpenRouterProvider backed by the real OpenAI SDK pointed at the
 * OpenRouter base URL. Not imported in tests — tests inject OpenAILike directly.
 */
export function createOpenRouterProvider(
  apiKey: string,
  model?: string,
): OpenRouterProvider {
  const client = new OpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    defaultHeaders: {
      'HTTP-Referer': 'https://github.com/blk-ink/master-ai-social',
      'X-Title': 'Social Manager AI',
    },
  }) as unknown as OpenAILike;
  return new OpenRouterProvider(client, model);
}
