import { randomUUID } from 'node:crypto';
import type {
  AIProvider,
  GenerateImageOptions,
  GenerateTextOptions,
} from '@mas/types';
import { systemPrompt } from './prompt';
import { CHATGPT_CODEX_BASE_URL } from './chatgptAuth';

/**
 * AI provider backed by "Sign in with ChatGPT" (Codex OAuth) — usage bills to
 * the user's ChatGPT plan, no API key.
 *
 * The chatgpt.com/backend-api/codex endpoint speaks the OpenAI Responses API
 * (NOT chat completions) and requires streaming plus codex-CLI-shaped
 * fingerprint headers: a Cloudflare layer in front of it whitelists known
 * originators, so we pin `originator: codex_cli_rs` and a matching User-Agent
 * (same approach as the Hermes agent and the official Codex CLI).
 */

export const CHATGPT_DEFAULT_MODEL = 'gpt-5.5';

export interface ChatGPTAuthSource {
  /** Returns a non-expired access token + ChatGPT account id. */
  ensureFresh(): Promise<{ accessToken: string; accountId: string | null }>;
}

/** Extract the concatenated output text from a Responses-API SSE body. */
export function parseResponsesSse(body: string): string {
  let text = '';
  let completedText: string | null = null;
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    let evt: Record<string, unknown>;
    try {
      evt = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = evt.type;
    if (
      type === 'response.output_text.delta' &&
      typeof evt.delta === 'string'
    ) {
      text += evt.delta;
    } else if (
      type === 'response.output_text.done' &&
      typeof evt.text === 'string'
    ) {
      // Authoritative per-item text; prefer it if deltas were dropped.
      completedText = (completedText ?? '') + evt.text;
    } else if (type === 'response.failed' || type === 'error') {
      const message =
        (evt.error as { message?: string } | undefined)?.message ??
        (typeof evt.message === 'string' ? evt.message : 'response.failed');
      throw new Error(`ChatGPT request failed: ${message}`);
    }
  }
  return completedText ?? text;
}

export class ChatGPTProvider implements AIProvider {
  readonly name = 'chatgpt' as const;

  constructor(
    private readonly auth: ChatGPTAuthSource,
    private readonly model?: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async generateText(
    prompt: string,
    options?: GenerateTextOptions,
  ): Promise<string> {
    const { accessToken, accountId } = await this.auth.ensureFresh();

    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'OpenAI-Beta': 'responses=experimental',
      originator: 'codex_cli_rs',
      'User-Agent': 'codex_cli_rs/0.0.0 (AICut)',
      session_id: randomUUID(),
    };
    if (accountId) headers['ChatGPT-Account-ID'] = accountId;

    const resp = await this.fetcher(`${CHATGPT_CODEX_BASE_URL}/responses`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.model ?? CHATGPT_DEFAULT_MODEL,
        instructions: systemPrompt(options),
        input: [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: prompt }],
          },
        ],
        tools: [],
        tool_choice: 'auto',
        parallel_tool_calls: false,
        store: false,
        stream: true,
        include: [],
      }),
    });

    if (!resp.ok) {
      const detail = (await resp.text().catch(() => '')).slice(0, 300);
      if (resp.status === 401) {
        throw new Error(
          'ChatGPT session rejected (401) — sign in again from Settings.',
        );
      }
      throw new Error(
        `ChatGPT request failed (HTTP ${resp.status}). ${detail}`,
      );
    }

    const body = await resp.text();
    const text = parseResponsesSse(body).trim();
    if (!text) throw new Error('ChatGPT returned an empty response.');
    return text;
  }

  async generateImage(
    _prompt: string,
    _options?: GenerateImageOptions,
  ): Promise<string> {
    throw new Error(
      'ChatGPT sign-in does not support image generation — add an OpenAI API key in Settings for images.',
    );
  }
}
