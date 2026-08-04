import type {
  AIProvider,
  AIProviderName,
  GenerateImageOptions,
  GenerateTextOptions,
} from '@mas/types';
import { resolveMaxTokens, systemPrompt } from './prompt';

// Minimal structural slice of groq-sdk (OpenAI-compatible chat surface).
export interface GroqLike {
  chat: {
    completions: {
      create(args: {
        model: string;
        max_tokens?: number;
        messages: Array<{ role: 'system' | 'user'; content: string }>;
      }): Promise<{
        choices: Array<{ message?: { content?: string | null } }>;
      }>;
    };
  };
}

export class GroqProvider implements AIProvider {
  readonly name: AIProviderName = 'groq';

  constructor(
    private readonly client: GroqLike,
    private readonly model = 'llama-3.3-70b-versatile',
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
      'Groq does not support image generation. Use the OpenAI provider for images.',
    );
  }
}
