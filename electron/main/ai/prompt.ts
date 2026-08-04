import { PLATFORM_CONFIG, type GenerateTextOptions } from '@mas/types';

const DEFAULT_MAX_TOKENS = 1024;

/** Build a system prompt that shapes copy to the target platform and tone. */
export function systemPrompt(options?: GenerateTextOptions): string {
  const parts = ['You are an expert US social media copywriter.'];
  if (options?.platform) {
    const cfg = PLATFORM_CONFIG[options.platform];
    parts.push(
      `Write for ${cfg.label}. Stay within ${cfg.maxChars} characters.`,
    );
  }
  if (options?.tone) parts.push(`Use a ${options.tone} tone.`);
  parts.push('Return only the post text, with no preamble or quotation marks.');
  return parts.join(' ');
}

export function resolveMaxTokens(options?: GenerateTextOptions): number {
  return options?.maxTokens ?? DEFAULT_MAX_TOKENS;
}
