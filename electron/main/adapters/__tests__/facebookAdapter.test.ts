import { describe, it, expect, beforeEach } from 'vitest';
import { PubType } from '@mas/types';
import type { AxiosRequestConfig } from 'axios';
import { FacebookAdapter } from '../facebookAdapter';
import type { AdapterHttp } from '../http';
import type { AdapterContext } from '../types';

interface Call {
  url: string;
  method: string;
  data?: any;
  params?: any;
}

// Records calls and returns queued responses in order.
class FakeHttp implements AdapterHttp {
  calls: Call[] = [];
  private queue: any[] = [];
  queueResponses(...responses: any[]) {
    this.queue.push(...responses);
  }
  async request<T>(config: AxiosRequestConfig): Promise<T> {
    this.calls.push({
      url: config.url!,
      method: (config.method ?? 'GET').toString().toUpperCase(),
      data: config.data,
      params: config.params,
    });
    return (this.queue.shift() ?? {}) as T;
  }
}

const ctx: AdapterContext = {
  accessToken: 'PAGE_TOKEN',
  externalId: 'PAGE_ID',
};

let http: FakeHttp;
let fb: FacebookAdapter;

beforeEach(() => {
  http = new FakeHttp();
  fb = new FacebookAdapter(http);
});

describe('FacebookAdapter.publish', () => {
  it('posts text-only to /feed with hashtags appended', async () => {
    http.queueResponses({ id: 'POST_1' });
    const res = await fb.publish(ctx, {
      pubType: PubType.IMAGE_TEXT,
      body: 'Hello world',
      hashtags: ['#a', '#b'],
      mediaUrls: [],
    });
    expect(res.externalPostId).toBe('POST_1');
    const call = http.calls[0];
    expect(call.url).toBe('https://graph.facebook.com/v21.0/PAGE_ID/feed');
    expect(call.method).toBe('POST');
    expect(call.data.message).toBe('Hello world\n\n#a #b');
    expect(call.data.attached_media).toBeUndefined();
  });

  it('uploads photos unpublished then attaches them to a feed post', async () => {
    http.queueResponses(
      { id: 'PH1' },
      { id: 'PH2' },
      { id: 'FEED', post_id: 'PAGE_POST' },
    );
    const res = await fb.publish(ctx, {
      pubType: PubType.IMAGE_TEXT,
      body: 'caption',
      hashtags: [],
      mediaUrls: ['http://img/1.jpg', 'http://img/2.jpg'],
    });
    expect(res.externalPostId).toBe('PAGE_POST');
    expect(http.calls).toHaveLength(3);
    expect(http.calls[0].url).toContain('/PAGE_ID/photos');
    expect(http.calls[0].data).toMatchObject({
      url: 'http://img/1.jpg',
      published: false,
    });
    expect(http.calls[2].url).toContain('/PAGE_ID/feed');
    expect(http.calls[2].data.attached_media).toEqual([
      { media_fbid: 'PH1' },
      { media_fbid: 'PH2' },
    ]);
  });

  it('publishes video by file_url', async () => {
    http.queueResponses({ id: 'VID_1' });
    const res = await fb.publish(ctx, {
      pubType: PubType.VIDEO,
      body: 'watch',
      hashtags: [],
      mediaUrls: ['http://v/clip.mp4'],
    });
    expect(res.externalPostId).toBe('VID_1');
    expect(http.calls[0].url).toContain('/PAGE_ID/videos');
    expect(http.calls[0].data).toMatchObject({
      file_url: 'http://v/clip.mp4',
      published: true,
    });
  });
});

describe('FacebookAdapter.fetchMetrics', () => {
  it('normalizes graph insights into PostMetrics', async () => {
    http.queueResponses({
      data: [
        { name: 'post_impressions', values: [{ value: 100 }] },
        { name: 'post_impressions_unique', values: [{ value: 80 }] },
        { name: 'post_engaged_users', values: [{ value: 12 }] },
        { name: 'post_clicks', values: [{ value: 5 }] },
      ],
    });
    const m = await fb.fetchMetrics(ctx, 'POST_1');
    expect(m).toEqual({
      impressions: 100,
      reach: 80,
      engagements: 12,
      clicks: 5,
    });
    expect(http.calls[0].url).toContain('/POST_1/insights');
  });

  it('defaults missing metrics to zero', async () => {
    http.queueResponses({
      data: [{ name: 'post_impressions', values: [{ value: 7 }] }],
    });
    const m = await fb.fetchMetrics(ctx, 'POST_1');
    expect(m).toEqual({ impressions: 7, reach: 0, engagements: 0, clicks: 0 });
  });
});

describe('FacebookAdapter.fetchComments / replyToComment', () => {
  it('maps comments to the normalized shape', async () => {
    http.queueResponses({
      data: [
        { id: 'C1', message: 'nice', from: { name: 'Jane', id: 'u1' } },
        { id: 'C2', from: {} },
      ],
    });
    const comments = await fb.fetchComments(ctx, 'POST_1');
    expect(comments).toEqual([
      {
        externalCommentId: 'C1',
        externalPostId: 'POST_1',
        authorHandle: 'Jane',
        text: 'nice',
      },
      {
        externalCommentId: 'C2',
        externalPostId: 'POST_1',
        authorHandle: '',
        text: '',
      },
    ]);
  });

  it('posts a reply to a comment', async () => {
    http.queueResponses({ id: 'REPLY_1' });
    const res = await fb.replyToComment(ctx, 'C1', 'thanks!');
    expect(res.externalCommentId).toBe('REPLY_1');
    expect(http.calls[0].url).toContain('/C1/comments');
    expect(http.calls[0].data).toEqual({ message: 'thanks!' });
  });
});
