import type {
  AIProvider,
  AIProviderName,
  GenerateImageOptions,
  GenerateTextOptions,
} from '@mas/types';
import { resolveMaxTokens, systemPrompt } from './prompt';

// Minimal structural slice of @anthropic-ai/sdk we depend on.
export interface AnthropicLike {
  messages: {
    create(args: {
      model: string;
      max_tokens: number;
      system?: string;
      messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    }): Promise<{ content: Array<{ type: string; text?: string }> }>;
  };
}

export class ClaudeProvider implements AIProvider {
  readonly name: AIProviderName = 'claude';

  constructor(
    private readonly client: AnthropicLike,
    private readonly model = 'claude-sonnet-4-6',
  ) {}

  async generateText(
    prompt: string,
    options?: GenerateTextOptions,
  ): Promise<string> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: resolveMaxTokens(options),
      system: systemPrompt(options),
      messages: [{ role: 'user', content: prompt }],
    });
    return res.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('')
      .trim();
  }

  async generateImage(
    _prompt: string,
    _options?: GenerateImageOptions,
  ): Promise<string> {
    throw new Error(
      'Claude does not support image generation. Use the OpenAI provider for images.',
    );
  }
}
