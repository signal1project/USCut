import type { AIProvider, GenerateImageOptions, Platform } from '@mas/types';
import type { PlatformAlgorithmAgent } from '../algorithm/algorithmAgent';
import type { BrandKit } from '../settings/settings';

export interface GeneratedContent {
  platform: Platform;
  body: string;
  hashtags: string[];
  /** 1-based variant index when multiple variants were requested. */
  variant?: number;
}

export interface GenerateResult {
  provider: string;
  items: GeneratedContent[];
}

export interface CarouselSlide {
  index: number;
  title: string;
  body: string;
  imagePrompt: string;
}

export interface CarouselResult {
  provider: string;
  platform: Platform;
  caption: string;
  hashtags: string[];
  slides: CarouselSlide[];
}

export interface ContentServiceDeps {
  /** The active text provider (from Settings). */
  resolveProvider: () => AIProvider;
  /** A provider that supports image generation (OpenAI); used by generateImage. */
  resolveImageProvider: () => AIProvider;
  /**
   * Optional algorithm agent — when provided, each platform prompt is prefixed
   * with algorithm-aware guidance to help the AI produce more algorithm-friendly
   * content.
   */
  algorithmAgent?: PlatformAlgorithmAgent;
  /**
   * Optional brand kit resolver — when it returns a kit, every brief is
   * suffixed with brand voice/audience/banned-word constraints so output
   * stays on-brand.
   */
  resolveBrandKit?: () => BrandKit | null;
}

/** Pull #hashtags out of generated copy (deduped, order-preserving). */
export function extractHashtags(text: string): string[] {
  const matches = text.match(/#[\p{L}0-9_]+/gu) ?? [];
  return [...new Set(matches)];
}

/**
 * Combine the user's brief with an algorithm hint so the AI understands the
 * platform's current reward signals.
 */
export function buildAlgorithmAwareBrief(
  brief: string,
  algorithmHint: string,
): string {
  return `${algorithmHint}\n\n---\nContent brief: ${brief}`;
}

/** Append brand-kit constraints to a brief. Exported for tests. */
export function buildBrandAwareBrief(brief: string, kit: BrandKit): string {
  const lines: string[] = [];
  if (kit.brandName) lines.push(`- Brand/company: ${kit.brandName}`);
  if (kit.bio) lines.push(`- Brand bio and business context: ${kit.bio}`);
  if (kit.voice) lines.push(`- Brand voice: ${kit.voice}`);
  if (kit.audience) lines.push(`- Target audience: ${kit.audience}`);
  if (kit.hashtags.length)
    lines.push(`- Prefer these hashtags: ${kit.hashtags.join(' ')}`);
  if (kit.bannedWords.length)
    lines.push(
      `- NEVER use these words/phrases: ${kit.bannedWords.join(', ')}`,
    );
  if (kit.signature)
    lines.push(`- End with this signature/CTA: ${kit.signature}`);
  if (lines.length === 0) return brief;
  return `${brief}\n\nBRAND RULES:\n${lines.join('\n')}`;
}

/**
 * Parse the AI's carousel JSON response defensively: accept a raw JSON array,
 * an object with a slides array, or JSON inside a fenced code block. Exported
 * for tests.
 */
export function parseCarouselResponse(
  raw: string,
  slideCount: number,
): CarouselSlide[] | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : raw).trim();
  const start = candidate.search(/[[{]/);
  if (start === -1) return null;
  try {
    const parsed = JSON.parse(candidate.slice(start)) as unknown;
    const arr = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { slides?: unknown[] }).slides)
        ? (parsed as { slides: unknown[] }).slides
        : null;
    if (!arr) return null;
    return arr.slice(0, slideCount).map((s, i) => {
      const slide = s as Partial<CarouselSlide> & { text?: string };
      return {
        index: i + 1,
        title: String(slide.title ?? `Slide ${i + 1}`),
        body: String(slide.body ?? slide.text ?? ''),
        imagePrompt: String(slide.imagePrompt ?? ''),
      };
    });
  } catch {
    return null;
  }
}

/**
 * Generates platform-tailored copy from a single brief by fanning out to the
 * active AI provider once per target platform (each call shaped by the
 * platform's length limit + tone via systemPrompt). When an algorithmAgent is
 * configured, each brief is prepended with the platform's algorithm playbook
 * hint; when a brand kit is configured, brand rules are appended.
 */
export class ContentService {
  constructor(private readonly deps: ContentServiceDeps) {}

  private shapeBrief(
    brief: string,
    platform: Platform,
    skipAlgorithmHints?: boolean,
  ): string {
    let shaped = brief;
    if (this.deps.algorithmAgent && !skipAlgorithmHints) {
      shaped = buildAlgorithmAwareBrief(
        shaped,
        this.deps.algorithmAgent.getPromptHint(platform),
      );
    }
    const kit = this.deps.resolveBrandKit?.() ?? null;
    if (kit) shaped = buildBrandAwareBrief(shaped, kit);
    return shaped;
  }

  async generate(input: {
    brief: string;
    platforms: Platform[];
    tone?: string;
    /** Number of A/B variants per platform (1–3, default 1). */
    variants?: number;
    /** Explicitly opt-out of algorithm injection even if an agent is configured. */
    skipAlgorithmHints?: boolean;
  }): Promise<GenerateResult> {
    const provider = this.deps.resolveProvider();
    const variantCount = Math.min(Math.max(input.variants ?? 1, 1), 3);

    const jobs: Array<{ platform: Platform; variant: number }> = [];
    for (const platform of input.platforms) {
      for (let v = 1; v <= variantCount; v++)
        jobs.push({ platform, variant: v });
    }

    const items = await Promise.all(
      jobs.map(async ({ platform, variant }): Promise<GeneratedContent> => {
        let brief = this.shapeBrief(
          input.brief,
          platform,
          input.skipAlgorithmHints,
        );
        if (variantCount > 1) {
          brief += `\n\nThis is variant ${variant} of ${variantCount} — take a distinctly different angle/hook from the other variants.`;
        }
        const body = await provider.generateText(brief, {
          platform,
          tone: input.tone,
        });
        return {
          platform,
          body,
          hashtags: extractHashtags(body),
          ...(variantCount > 1 ? { variant } : {}),
        };
      }),
    );
    return { provider: provider.name, items };
  }

  /**
   * Generate a multi-slide carousel: hook slide → value slides → CTA slide,
   * plus a post caption. Falls back to a deterministic slide split if the AI
   * response can't be parsed as JSON.
   */
  async generateCarousel(input: {
    brief: string;
    platform: Platform;
    slideCount?: number;
    tone?: string;
  }): Promise<CarouselResult> {
    const provider = this.deps.resolveProvider();
    const slideCount = Math.min(Math.max(input.slideCount ?? 5, 3), 10);
    const brief = this.shapeBrief(input.brief, input.platform);

    const prompt = `${brief}

Create a ${slideCount}-slide social media carousel for ${input.platform}.
Slide 1 must be a scroll-stopping hook. The last slide must be a call-to-action.
Respond with ONLY a JSON object of this exact shape:
{"caption": "post caption with hashtags", "slides": [{"title": "...", "body": "1-2 short sentences", "imagePrompt": "visual description for this slide"}]}`;

    const raw = await provider.generateText(prompt, {
      platform: input.platform,
      tone: input.tone,
    });
    let slides = parseCarouselResponse(raw, slideCount);
    let caption = '';

    if (slides) {
      const capMatch = raw.match(/"caption"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      caption = capMatch ? JSON.parse(`"${capMatch[1]}"`) : '';
    } else {
      // Deterministic fallback: split the raw text into slides.
      const sentences = raw
        .replace(/\s+/g, ' ')
        .split(/(?<=[.!?])\s+/)
        .filter(Boolean);
      const per = Math.max(1, Math.ceil(sentences.length / slideCount));
      slides = Array.from({ length: slideCount }, (_, i) => ({
        index: i + 1,
        title:
          i === 0
            ? 'Hook'
            : i === slideCount - 1
              ? 'Call to action'
              : `Slide ${i + 1}`,
        body: sentences.slice(i * per, (i + 1) * per).join(' ') || '…',
        imagePrompt: '',
      }));
      caption = sentences.slice(0, 2).join(' ');
    }

    return {
      provider: provider.name,
      platform: input.platform,
      caption,
      hashtags: extractHashtags(`${caption} ${raw}`),
      slides,
    };
  }

  async generateImage(
    prompt: string,
    options?: GenerateImageOptions,
  ): Promise<{ url: string }> {
    const provider = this.deps.resolveImageProvider();
    const url = await provider.generateImage(prompt, options);
    return { url };
  }
}
