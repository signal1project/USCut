import { describe, it, expect, beforeEach } from 'vitest';
import { PubType } from '@mas/types';
import type { AxiosRequestConfig } from 'axios';
import { InstagramAdapter } from '../instagramAdapter';
import { TwitterAdapter } from '../twitterAdapter';
import { PinterestAdapter } from '../pinterestAdapter';
import { ThreadsAdapter } from '../threadsAdapter';
import { buildAdapterRegistry } from '../registry';
import type { AdapterHttp } from '../http';
import type { AdapterContext, PublishInput } from '../types';

interface Call {
  url: string;
  method: string;
  data?: any;
  params?: any;
}
class FakeHttp implements AdapterHttp {
  calls: Call[] = [];
  private queue: any[] = [];
  queueResponses(...r: any[]) {
    this.queue.push(...r);
  }
  async request<T>(c: AxiosRequestConfig): Promise<T> {
    this.calls.push({
      url: c.url!,
      method: (c.method ?? 'GET').toString().toUpperCase(),
      data: c.data,
      params: c.params,
    });
    return (this.queue.shift() ?? {}) as T;
  }
}

const text: PublishInput = {
  pubType: PubType.IMAGE_TEXT,
  body: 'hi',
  hashtags: ['#x'],
  mediaUrls: [],
};
const photo: PublishInput = { ...text, mediaUrls: ['http://i/1.jpg'] };

let http: FakeHttp;
beforeEach(() => {
  http = new FakeHttp();
});

describe('InstagramAdapter', () => {
  it('publishes via container then media_publish', async () => {
    http.queueResponses({ id: 'CONTAINER' }, { id: 'IG_POST' });
    const ig = new InstagramAdapter(http);
    const ctx: AdapterContext = { accessToken: 'T', externalId: 'IG_USER' };
    const res = await ig.publish(ctx, photo);
    expect(res.externalPostId).toBe('IG_POST');
    expect(http.calls[0].url).toContain('/IG_USER/media');
    expect(http.calls[0].data).toMatchObject({
      image_url: 'http://i/1.jpg',
      caption: 'hi\n\n#x',
    });
    expect(http.calls[1].url).toContain('/IG_USER/media_publish');
    expect(http.calls[1].data).toEqual({ creation_id: 'CONTAINER' });
  });

  it('normalizes insights', async () => {
    http.queueResponses({
      data: [
        { name: 'impressions', values: [{ value: 50 }] },
        { name: 'reach', values: [{ value: 40 }] },
        { name: 'total_interactions', values: [{ value: 9 }] },
      ],
    });
    const m = await new InstagramAdapter(http).fetchMetrics(
      { accessToken: 'T', externalId: 'X' },
      'P',
    );
    expect(m).toEqual({
      impressions: 50,
      reach: 40,
      engagements: 9,
      clicks: 0,
    });
  });
});

describe('TwitterAdapter', () => {
  const ctx: AdapterContext = { accessToken: 'BEARER', externalId: 'me' };
  it('publishes a text tweet', async () => {
    http.queueResponses({ data: { id: 'TW1', text: 'hi\n\n#x' } });
    const res = await new TwitterAdapter(http).publish(ctx, text);
    expect(res.externalPostId).toBe('TW1');
    expect(http.calls[0].url).toContain('/tweets');
    expect(http.calls[0].data.text).toBe('hi\n\n#x');
  });

  it('clamps over-length tweets', async () => {
    http.queueResponses({ data: { id: 'TW2', text: '' } });
    const long = 'a'.repeat(400);
    await new TwitterAdapter(http).publish(ctx, {
      ...text,
      body: long,
      hashtags: [],
    });
    expect(http.calls[0].data.text.length).toBe(280);
    expect(http.calls[0].data.text.endsWith('…')).toBe(true);
  });

  it('sums public metrics into engagements', async () => {
    http.queueResponses({
      data: {
        public_metrics: {
          impression_count: 200,
          like_count: 5,
          reply_count: 2,
          retweet_count: 1,
          quote_count: 1,
        },
      },
    });
    const m = await new TwitterAdapter(http).fetchMetrics(ctx, 'TW1');
    expect(m).toEqual({
      impressions: 200,
      reach: 200,
      engagements: 9,
      clicks: 0,
    });
  });

  it('replies with in_reply_to_tweet_id', async () => {
    http.queueResponses({ data: { id: 'R1', text: 'thx' } });
    const res = await new TwitterAdapter(http).replyToComment(
      ctx,
      'TW1',
      'thx',
    );
    expect(res.externalCommentId).toBe('R1');
    expect(http.calls[0].data.reply).toEqual({ in_reply_to_tweet_id: 'TW1' });
  });
});

describe('PinterestAdapter', () => {
  it('requires a boardId', async () => {
    await expect(
      new PinterestAdapter(http).publish(
        { accessToken: 'T', externalId: 'u' },
        photo,
      ),
    ).rejects.toThrow(/boardId/);
  });

  it('publishes a pin with media_source', async () => {
    http.queueResponses({ id: 'PIN1' });
    const ctx: AdapterContext = {
      accessToken: 'T',
      externalId: 'u',
      meta: { boardId: 'B1' },
    };
    const res = await new PinterestAdapter(http).publish(ctx, photo);
    expect(res.externalPostId).toBe('PIN1');
    expect(http.calls[0].data).toMatchObject({
      board_id: 'B1',
      media_source: { source_type: 'image_url', url: 'http://i/1.jpg' },
    });
  });

  it('aggregates daily analytics', async () => {
    http.queueResponses({
      all: {
        daily_metrics: [
          {
            metrics: {
              IMPRESSION: 10,
              SAVE: 1,
              PIN_CLICK: 2,
              OUTBOUND_CLICK: 3,
            },
          },
          {
            metrics: {
              IMPRESSION: 5,
              SAVE: 1,
              PIN_CLICK: 0,
              OUTBOUND_CLICK: 1,
            },
          },
        ],
      },
    });
    const m = await new PinterestAdapter(http).fetchMetrics(
      { accessToken: 'T', externalId: 'u' },
      'PIN1',
    );
    expect(m).toEqual({
      impressions: 15,
      reach: 15,
      engagements: 4,
      clicks: 4,
    });
  });

  it('has no comment support', async () => {
    expect(await new PinterestAdapter(http).fetchComments()).toEqual([]);
    await expect(new PinterestAdapter(http).replyToComment()).rejects.toThrow();
  });
});

describe('ThreadsAdapter', () => {
  const ctx: AdapterContext = { accessToken: 'T', externalId: 'TH_USER' };
  it('publishes text via container flow with media_type TEXT', async () => {
    http.queueResponses({ id: 'C' }, { id: 'TH1' });
    const res = await new ThreadsAdapter(http).publish(ctx, text);
    expect(res.externalPostId).toBe('TH1');
    expect(http.calls[0].data).toMatchObject({
      media_type: 'TEXT',
      text: 'hi\n\n#x',
    });
    expect(http.calls[1].url).toContain('/threads_publish');
  });

  it('uses IMAGE media_type when a photo is present', async () => {
    http.queueResponses({ id: 'C' }, { id: 'TH2' });
    await new ThreadsAdapter(http).publish(ctx, photo);
    expect(http.calls[0].data).toMatchObject({
      media_type: 'IMAGE',
      image_url: 'http://i/1.jpg',
    });
  });

  it('replies via a reply_to_id container', async () => {
    http.queueResponses({ id: 'C' }, { id: 'THR1' });
    const res = await new ThreadsAdapter(http).replyToComment(ctx, 'TH1', 'yo');
    expect(res.externalCommentId).toBe('THR1');
    expect(http.calls[0].data).toMatchObject({
      reply_to_id: 'TH1',
      media_type: 'TEXT',
    });
  });
});

describe('adapter registry', () => {
  it('registers all five Tier 1 platforms', () => {
    const reg = buildAdapterRegistry(http);
    for (const p of [
      'facebook',
      'instagram',
      'twitter',
      'pinterest',
      'threads',
    ] as const) {
      expect(reg.get(p)?.platform).toBe(p);
    }
  });
});
