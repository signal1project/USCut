import { describe, it, expect } from 'vitest';
import { PubType } from '@mas/types';
import {
  TikTokAdapter,
  YouTubeAdapter,
  LinkedInAdapter,
  TierTwoNotApprovedError,
} from '../tier2Stubs';
import { buildAdapterRegistry, getAdapter } from '../registry';
import type { AdapterContext, PublishInput } from '../types';

const ctx: AdapterContext = { accessToken: 'T', externalId: 'X' };
const input: PublishInput = {
  pubType: PubType.VIDEO,
  body: 'b',
  hashtags: [],
  mediaUrls: ['u'],
};

describe('Tier 2 stub adapters', () => {
  const cases = [
    ['tiktok', new TikTokAdapter()],
    ['youtube', new YouTubeAdapter()],
    ['linkedin', new LinkedInAdapter()],
  ] as const;

  for (const [platform, adapter] of cases) {
    it(`${platform} reports its platform and refuses all operations`, async () => {
      expect(adapter.platform).toBe(platform);
      await expect(adapter.publish(ctx, input)).rejects.toBeInstanceOf(
        TierTwoNotApprovedError,
      );
      await expect(adapter.fetchMetrics(ctx, 'p')).rejects.toThrow(/Tier 2/);
      await expect(adapter.fetchComments(ctx, 'p')).rejects.toThrow(/approval/);
      await expect(adapter.replyToComment(ctx, 'c', 'm')).rejects.toThrow(
        /requires developer/,
      );
    });
  }
});

describe('registry includes all eight platforms', () => {
  it('maps every platform, Tier 1 + Tier 2', () => {
    const reg = buildAdapterRegistry();
    const all = [
      'facebook',
      'instagram',
      'twitter',
      'pinterest',
      'threads',
      'tiktok',
      'youtube',
      'linkedin',
    ] as const;
    expect([...reg.keys()].sort()).toEqual([...all].sort());
  });

  it('getAdapter returns the right adapter and throws for unknown', () => {
    expect(getAdapter('youtube').platform).toBe('youtube');
    // @ts-expect-error invalid platform
    expect(() => getAdapter('myspace')).toThrow(/No platform adapter/);
  });
});
