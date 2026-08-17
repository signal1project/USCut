import type {
  AIProvider,
  AIProviderName,
  AnalyzeFramesInput,
  GenerateImageOptions,
  GenerateTextOptions,
} from '@mas/types';
import { resolveMaxTokens, systemPrompt } from './prompt';

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image';
      source: { type: 'base64'; media_type: 'image/jpeg'; data: string };
    };

// Minimal structural slice of @anthropic-ai/sdk we depend on.
export interface AnthropicLike {
  messages: {
    create(args: {
      model: string;
      max_tokens: number;
      system?: string;
      messages: Array<{
        role: 'user' | 'assistant';
        content: string | AnthropicContentBlock[];
      }>;
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

  async analyzeFrames(
    frames: AnalyzeFramesInput[],
    prompt: string,
  ): Promise<string> {
    const content: AnthropicContentBlock[] = [];
    for (const frame of frames) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/jpeg',
          data: frame.base64Jpeg,
        },
      });
      content.push({
        type: 'text',
        text: `[frame at ${frame.timestampSeconds.toFixed(2)}s]`,
      });
    }
    content.push({ type: 'text', text: prompt });

    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 2048,
      messages: [{ role: 'user', content }],
    });
    return res.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('')
      .trim();
  }
}
