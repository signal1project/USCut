import type {
  AIProvider,
  AIProviderName,
  GenerateImageOptions,
  GenerateTextOptions,
} from '@mas/types';
import { resolveMaxTokens, systemPrompt } from './prompt';

// Minimal structural slice of the openai SDK we depend on.
export interface OpenAILike {
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
  images: {
    generate(args: {
      model: string;
      prompt: string;
      size: string;
      n?: number;
    }): Promise<{ data: Array<{ url?: string; b64_json?: string }> }>;
  };
}

export class OpenAIProvider implements AIProvider {
  readonly name: AIProviderName = 'openai';

  constructor(
    private readonly client: OpenAILike,
    private readonly textModel = 'gpt-4o',
    private readonly imageModel = 'dall-e-3',
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
    prompt: string,
    options?: GenerateImageOptions,
  ): Promise<string> {
    const size = `${options?.width ?? 1024}x${options?.height ?? 1024}`;
    const res = await this.client.images.generate({
      model: this.imageModel,
      prompt,
      size,
      n: 1,
    });
    const first = res.data[0];
    const url =
      first?.url ??
      (first?.b64_json ? `data:image/png;base64,${first.b64_json}` : '');
    if (!url) throw new Error('OpenAI returned no image.');
    return url;
  }
}
