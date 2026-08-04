import { describe, it, expect } from 'vitest';
import type { AIProvider } from '@mas/types';
import {
  ContentService,
  buildBrandAwareBrief,
  parseCarouselResponse,
} from '../contentService';
import type { BrandKit } from '../../settings/settings';

const kit: BrandKit = {
  brandName: 'Signal Realty',
  bio: 'A local brokerage serving Houston families.',
  voice: 'warm, confident',
  audience: 'first-time buyers',
  hashtags: ['#HoustonHomes'],
  bannedWords: ['cheap', 'guaranteed'],
  signature: 'DM HOME for a consult',
};

function mockProvider(reply: (prompt: string) => string): AIProvider {
  return {
    name: 'mock',
    generateText: async (prompt: string) => reply(prompt),
    generateImage: async () => '',
  } as unknown as AIProvider;
}

describe('buildBrandAwareBrief', () => {
  it('appends all brand rules', () => {
    const brief = buildBrandAwareBrief('post about spring market', kit);
    expect(brief).toContain('Brand voice: warm, confident');
    expect(brief).toContain('Brand/company: Signal Realty');
    expect(brief).toContain('local brokerage serving Houston');
    expect(brief).toContain('first-time buyers');
    expect(brief).toContain('#HoustonHomes');
    expect(brief).toContain('NEVER use these words/phrases: cheap, guaranteed');
    expect(brief).toContain('DM HOME for a consult');
  });

  it('is a no-op for an empty kit', () => {
    const empty: BrandKit = {
      voice: '',
      audience: '',
      hashtags: [],
      bannedWords: [],
      signature: '',
    };
    expect(buildBrandAwareBrief('hello', empty)).toBe('hello');
  });
});

describe('ContentService brand + variants', () => {
  it('injects the brand kit into prompts and tags variants', async () => {
    const prompts: string[] = [];
    const svc = new ContentService({
      resolveProvider: () =>
        mockProvider((p) => {
          prompts.push(p);
          return 'copy #Tag';
        }),
      resolveImageProvider: () => mockProvider(() => ''),
      resolveBrandKit: () => kit,
    });
    const result = await svc.generate({
      brief: 'open house',
      platforms: ['facebook'],
      variants: 2,
    });
    expect(result.items).toHaveLength(2);
    expect(result.items.map((i) => i.variant).sort()).toEqual([1, 2]);
    expect(prompts[0]).toContain('Brand voice');
    expect(prompts[0]).toContain('variant 1 of 2');
  });

  it('defaults to a single untagged item', async () => {
    const svc = new ContentService({
      resolveProvider: () => mockProvider(() => 'plain copy'),
      resolveImageProvider: () => mockProvider(() => ''),
    });
    const result = await svc.generate({ brief: 'x', platforms: ['instagram'] });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].variant).toBeUndefined();
  });
});

describe('parseCarouselResponse', () => {
  it('parses a clean JSON object with slides', () => {
    const raw =
      '{"caption": "cap #x", "slides": [{"title":"Hook","body":"b1","imagePrompt":"img"},{"title":"CTA","body":"b2","imagePrompt":""}]}';
    const slides = parseCarouselResponse(raw, 5);
    expect(slides).toHaveLength(2);
    expect(slides![0]).toMatchObject({ index: 1, title: 'Hook', body: 'b1' });
  });

  it('parses fenced JSON and bare arrays', () => {
    const fenced = '```json\n[{"title":"A","body":"x"}]\n```';
    expect(parseCarouselResponse(fenced, 3)).toHaveLength(1);
  });

  it('returns null on prose', () => {
    expect(parseCarouselResponse('Here are some ideas for you.', 5)).toBeNull();
  });
});

describe('generateCarousel', () => {
  it('builds slides + caption from a JSON response', async () => {
    const svc = new ContentService({
      resolveProvider: () =>
        mockProvider(
          () =>
            '{"caption": "Buy smart #RealEstate", "slides": [{"title":"Hook","body":"Stop.","imagePrompt":"stop sign"},{"title":"Tip","body":"Get pre-approved.","imagePrompt":"bank"},{"title":"CTA","body":"DM me.","imagePrompt":"phone"}]}',
        ),
      resolveImageProvider: () => mockProvider(() => ''),
    });
    const result = await svc.generateCarousel({
      brief: 'buyer tips',
      platform: 'instagram',
      slideCount: 3,
    });
    expect(result.slides).toHaveLength(3);
    expect(result.caption).toBe('Buy smart #RealEstate');
    expect(result.hashtags).toContain('#RealEstate');
  });

  it('falls back to sentence-split slides on prose output', async () => {
    const svc = new ContentService({
      resolveProvider: () =>
        mockProvider(
          () =>
            'First idea here. Second idea there. Third one. Fourth. Fifth and final.',
        ),
      resolveImageProvider: () => mockProvider(() => ''),
    });
    const result = await svc.generateCarousel({
      brief: 'x',
      platform: 'instagram',
      slideCount: 5,
    });
    expect(result.slides).toHaveLength(5);
    expect(result.slides[0].title).toBe('Hook');
    expect(result.slides[4].title).toBe('Call to action');
  });
});
