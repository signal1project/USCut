import { describe, it, expect } from 'vitest';
import { ClaudeProvider, type AnthropicLike } from '../claudeProvider';
import { OpenAIProvider, type OpenAILike } from '../openaiProvider';
import { GroqProvider, type GroqLike } from '../groqProvider';
import { OpenRouterProvider } from '../openRouterProvider';
import {
  OllamaProvider,
  type OllamaDiscoverer,
  type OllamaModel,
} from '../ollamaProvider';
import {
  buildOpenRouterAuthUrl,
  exchangeOpenRouterCode,
} from '../openRouterOAuth';
import { systemPrompt } from '../prompt';

// ── systemPrompt ──────────────────────────────────────────────────────────────

describe('systemPrompt', () => {
  it('embeds platform length limit and tone', () => {
    const p = systemPrompt({ platform: 'twitter', tone: 'witty' });
    expect(p).toContain('Twitter/X');
    expect(p).toContain('280 characters');
    expect(p).toContain('witty tone');
  });

  it('omits platform guidance when no platform given', () => {
    expect(systemPrompt()).not.toMatch(/characters/);
  });
});

// ── ClaudeProvider ────────────────────────────────────────────────────────────

describe('ClaudeProvider', () => {
  it('passes system + max_tokens and joins text blocks', async () => {
    let captured: any;
    const client: AnthropicLike = {
      messages: {
        create: async (args) => {
          captured = args;
          return {
            content: [
              { type: 'text', text: 'Hello ' },
              { type: 'text', text: 'world' },
            ],
          };
        },
      },
    };
    const out = await new ClaudeProvider(client).generateText('brief', {
      platform: 'facebook',
      maxTokens: 200,
    });
    expect(out).toBe('Hello world');
    expect(captured.max_tokens).toBe(200);
    expect(captured.system).toContain('Facebook');
    expect(captured.messages).toEqual([{ role: 'user', content: 'brief' }]);
  });

  it('refuses image generation', async () => {
    const client = {
      messages: { create: async () => ({ content: [] }) },
    } as AnthropicLike;
    await expect(new ClaudeProvider(client).generateImage('x')).rejects.toThrow(
      /does not support image/,
    );
  });

  it('analyzeFrames sends each frame as an image block plus the prompt', async () => {
    let captured: any;
    const client: AnthropicLike = {
      messages: {
        create: async (args) => {
          captured = args;
          return { content: [{ type: 'text', text: '{"points":[]}' }] };
        },
      },
    };
    const out = await new ClaudeProvider(client).analyzeFrames(
      [
        { timestampSeconds: 0, base64Jpeg: 'AAA' },
        { timestampSeconds: 1, base64Jpeg: 'BBB' },
      ],
      'locate the subject',
    );
    expect(out).toBe('{"points":[]}');
    const content = captured.messages[0].content;
    expect(content.filter((b: any) => b.type === 'image')).toHaveLength(2);
    expect(content[0].source).toEqual({
      type: 'base64',
      media_type: 'image/jpeg',
      data: 'AAA',
    });
    expect(content.at(-1)).toEqual({ type: 'text', text: 'locate the subject' });
  });
});

// ── OpenAIProvider ────────────────────────────────────────────────────────────

describe('OpenAIProvider', () => {
  const chatClient = (content: string | null): OpenAILike => ({
    chat: {
      completions: {
        create: async () => ({ choices: [{ message: { content } }] }),
      },
    },
    images: {
      generate: async () => ({ data: [{ url: 'http://img/out.png' }] }),
    },
  });

  it('returns trimmed chat content', async () => {
    const out = await new OpenAIProvider(
      chatClient('  hi there  '),
    ).generateText('brief');
    expect(out).toBe('hi there');
  });

  it('generates an image URL with sized request', async () => {
    let captured: any;
    const client: OpenAILike = {
      chat: { completions: { create: async () => ({ choices: [] }) } },
      images: {
        generate: async (a) => {
          captured = a;
          return { data: [{ url: 'http://img/x.png' }] };
        },
      },
    };
    const url = await new OpenAIProvider(client).generateImage('a cat', {
      width: 512,
      height: 512,
    });
    expect(url).toBe('http://img/x.png');
    expect(captured.size).toBe('512x512');
  });

  it('falls back to b64 data URL when no url', async () => {
    const client: OpenAILike = {
      chat: { completions: { create: async () => ({ choices: [] }) } },
      images: { generate: async () => ({ data: [{ b64_json: 'AAAA' }] }) },
    };
    const url = await new OpenAIProvider(client).generateImage('x');
    expect(url).toBe('data:image/png;base64,AAAA');
  });

  it('analyzeFrames sends each frame as a data-URI image_url part plus the prompt', async () => {
    let captured: any;
    const client: OpenAILike = {
      chat: {
        completions: {
          create: async (args) => {
            captured = args;
            return { choices: [{ message: { content: '{"points":[]}' } }] };
          },
        },
      },
      images: { generate: async () => ({ data: [] }) },
    };
    const out = await new OpenAIProvider(client).analyzeFrames(
      [{ timestampSeconds: 0, base64Jpeg: 'AAA' }],
      'locate the subject',
    );
    expect(out).toBe('{"points":[]}');
    const content = captured.messages[0].content;
    expect(content[0]).toEqual({ type: 'text', text: 'locate the subject' });
    const imagePart = content.find((b: any) => b.type === 'image_url');
    expect(imagePart.image_url.url).toBe('data:image/jpeg;base64,AAA');
  });
});

// ── GroqProvider ──────────────────────────────────────────────────────────────

describe('GroqProvider', () => {
  it('returns chat content and refuses images', async () => {
    const client: GroqLike = {
      chat: {
        completions: {
          create: async () => ({
            choices: [{ message: { content: 'groq out' } }],
          }),
        },
      },
    };
    const p = new GroqProvider(client);
    expect(await p.generateText('brief')).toBe('groq out');
    await expect(p.generateImage('x')).rejects.toThrow(
      /does not support image/,
    );
  });
});

// ── OpenRouterProvider ────────────────────────────────────────────────────────

describe('OpenRouterProvider', () => {
  const makeClient = (content: string): OpenAILike => ({
    chat: {
      completions: {
        create: async () => ({ choices: [{ message: { content } }] }),
      },
    },
    images: { generate: async () => ({ data: [] }) },
  });

  it('provider name is openrouter', () => {
    expect(new OpenRouterProvider(makeClient('')).name).toBe('openrouter');
  });

  it('returns trimmed chat response', async () => {
    const out = await new OpenRouterProvider(
      makeClient('  hello from router  '),
    ).generateText('brief');
    expect(out).toBe('hello from router');
  });

  it('passes system prompt + platform token limit', async () => {
    let captured: any;
    const client: OpenAILike = {
      chat: {
        completions: {
          create: async (a) => {
            captured = a;
            return { choices: [{ message: { content: 'ok' } }] };
          },
        },
      },
      images: { generate: async () => ({ data: [] }) },
    };
    await new OpenRouterProvider(
      client,
      'anthropic/claude-3-5-sonnet',
    ).generateText('brief', {
      platform: 'instagram',
    });
    expect(captured.model).toBe('anthropic/claude-3-5-sonnet');
    expect(captured.messages[0].role).toBe('system');
    expect(captured.messages[0].content).toContain('Instagram');
  });

  it('refuses image generation', async () => {
    await expect(
      new OpenRouterProvider(makeClient('')).generateImage('x'),
    ).rejects.toThrow(/does not support image/);
  });
});

// ── OllamaProvider ────────────────────────────────────────────────────────────

describe('OllamaProvider', () => {
  const makeClient = (content: string): OpenAILike => ({
    chat: {
      completions: {
        create: async () => ({ choices: [{ message: { content } }] }),
      },
    },
    images: { generate: async () => ({ data: [] }) },
  });

  it('provider name is ollama', () => {
    expect(new OllamaProvider(makeClient('')).name).toBe('ollama');
  });

  it('returns chat response', async () => {
    const out = await new OllamaProvider(
      makeClient('ollama says hi'),
    ).generateText('brief');
    expect(out).toBe('ollama says hi');
  });

  it('refuses image generation', async () => {
    await expect(
      new OllamaProvider(makeClient('')).generateImage('x'),
    ).rejects.toThrow(/does not support image/);
  });
});

// ── OllamaDiscoverer ──────────────────────────────────────────────────────────

describe('OllamaDiscoverer (stub)', () => {
  const models: OllamaModel[] = [
    {
      name: 'llama3',
      size: 4_700_000_000,
      modified_at: '2024-01-01T00:00:00Z',
    },
    {
      name: 'mistral',
      size: 3_800_000_000,
      modified_at: '2024-01-02T00:00:00Z',
    },
  ];

  const stubDiscoverer: OllamaDiscoverer = {
    listModels: async (_url) => models,
  };

  it('returns model list from stub', async () => {
    const result = await stubDiscoverer.listModels('http://localhost:11434');
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('llama3');
    expect(result[1].name).toBe('mistral');
  });
});

// ── OpenRouter OAuth ──────────────────────────────────────────────────────────

describe('buildOpenRouterAuthUrl', () => {
  it('produces a valid openrouter.ai auth URL with PKCE params', () => {
    const pending = buildOpenRouterAuthUrl();
    expect(pending.url).toContain('https://openrouter.ai/auth');
    expect(pending.url).toContain('code_challenge=');
    expect(pending.url).toContain('code_challenge_method=S256');
    expect(pending.url).toContain('callback_url=');
    expect(pending.codeVerifier).toBeTruthy();
    expect(pending.state).toBeTruthy();
  });

  it('generates unique verifiers and states per call', () => {
    const a = buildOpenRouterAuthUrl();
    const b = buildOpenRouterAuthUrl();
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
    expect(a.state).not.toBe(b.state);
  });
});

describe('exchangeOpenRouterCode', () => {
  it('returns the API key on success', async () => {
    const fakeFetch = async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ key: 'sk-or-v1-testkey' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    const key = await exchangeOpenRouterCode(
      'auth-code-123',
      'verifier-abc',
      fakeFetch as typeof fetch,
    );
    expect(key).toBe('sk-or-v1-testkey');
  });

  it('throws on HTTP error', async () => {
    const fakeFetch = async () => new Response('Unauthorized', { status: 401 });

    await expect(
      exchangeOpenRouterCode('bad-code', 'verifier', fakeFetch as typeof fetch),
    ).rejects.toThrow(/401/);
  });

  it('throws when response has no key field', async () => {
    const fakeFetch = async () =>
      new Response(JSON.stringify({ error: 'invalid_code' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    await expect(
      exchangeOpenRouterCode('code', 'verifier', fakeFetch as typeof fetch),
    ).rejects.toThrow(/did not return an API key/);
  });
});
