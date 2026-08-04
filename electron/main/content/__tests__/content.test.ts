import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AIProvider, GenerateTextOptions } from '@mas/types';
import { ContentService, extractHashtags } from '../contentService';
import { createContentRouter } from '../router';
import { startApiServer, type RunningApiServer } from '../../server';

class FakeProvider implements AIProvider {
  readonly name = 'claude' as const;
  lastOptions?: GenerateTextOptions;
  async generateText(
    prompt: string,
    options?: GenerateTextOptions,
  ): Promise<string> {
    this.lastOptions = options;
    return `${options?.platform ?? 'generic'} post for "${prompt}" #social #${options?.platform ?? 'x'}`;
  }
  async generateImage(): Promise<string> {
    return 'http://img/generated.png';
  }
}

describe('extractHashtags', () => {
  it('extracts and dedupes hashtags', () => {
    expect(extractHashtags('hello #fun world #fun #news')).toEqual([
      '#fun',
      '#news',
    ]);
  });
  it('returns empty when none present', () => {
    expect(extractHashtags('no tags here')).toEqual([]);
  });
});

describe('ContentService.generate', () => {
  it('fans out to each platform with platform+tone options', async () => {
    const provider = new FakeProvider();
    const svc = new ContentService({
      resolveProvider: () => provider,
      resolveImageProvider: () => provider,
    });
    const result = await svc.generate({
      brief: 'launch sale',
      platforms: ['facebook', 'twitter'],
      tone: 'excited',
    });
    expect(result.provider).toBe('claude');
    expect(result.items.map((i) => i.platform)).toEqual([
      'facebook',
      'twitter',
    ]);
    expect(result.items[0].body).toContain('facebook post');
    expect(result.items[0].hashtags).toContain('#social');
    expect(provider.lastOptions?.tone).toBe('excited');
  });

  it('generates an image via the image provider', async () => {
    const provider = new FakeProvider();
    const svc = new ContentService({
      resolveProvider: () => provider,
      resolveImageProvider: () => provider,
    });
    expect(await svc.generateImage('a cat')).toEqual({
      url: 'http://img/generated.png',
    });
  });
});

describe('content API routes', () => {
  let api: RunningApiServer;
  beforeAll(async () => {
    const provider = new FakeProvider();
    const svc = new ContentService({
      resolveProvider: () => provider,
      resolveImageProvider: () => provider,
    });
    api = await startApiServer({
      token: 'T',
      routes: [{ path: '/content', router: createContentRouter(svc) }],
    });
  });
  afterAll(async () => {
    await api.close();
  });

  const headers = {
    Authorization: 'Bearer T',
    'Content-Type': 'application/json',
  };

  it('POST /api/content/generate returns per-platform items', async () => {
    const res = await fetch(`${api.url}/api/content/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        brief: 'new product',
        platforms: ['instagram'],
        tone: 'fun',
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.items[0].platform).toBe('instagram');
  });

  it('rejects an unknown platform (400)', async () => {
    const res = await fetch(`${api.url}/api/content/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ brief: 'x', platforms: ['myspace'] }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/content/image returns a url', async () => {
    const res = await fetch(`${api.url}/api/content/image`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ prompt: 'sunset', width: 512, height: 512 }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'http://img/generated.png' });
  });
});
