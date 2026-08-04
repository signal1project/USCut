import { PLATFORM_CONFIG, type Platform } from '@mas/types';
import type {
  AdapterContext,
  PlatformAdapter,
  PlatformComment,
  PostMetrics,
  PublishInput,
  PublishResult,
} from './types';

/** Thrown by Tier 2 adapters until the platform grants developer/publishing approval. */
export class TierTwoNotApprovedError extends Error {
  constructor(platform: Platform) {
    super(
      `${PLATFORM_CONFIG[platform].label} is a Tier 2 platform and requires developer ` +
        `approval before publishing. This integration is stubbed pending approval.`,
    );
    this.name = 'TierTwoNotApprovedError';
  }
}

/**
 * Stub for Tier 2 platforms (TikTok, YouTube, LinkedIn). Implements the full
 * PlatformAdapter surface but refuses operations until approval lands. Keeping
 * them registered lets the UI list them as "pending approval" rather than
 * silently absent.
 */
abstract class Tier2StubAdapter implements PlatformAdapter {
  abstract readonly platform: Platform;

  async publish(
    _ctx: AdapterContext,
    _input: PublishInput,
  ): Promise<PublishResult> {
    throw new TierTwoNotApprovedError(this.platform);
  }
  async fetchMetrics(
    _ctx: AdapterContext,
    _externalPostId: string,
  ): Promise<PostMetrics> {
    throw new TierTwoNotApprovedError(this.platform);
  }
  async fetchComments(
    _ctx: AdapterContext,
    _externalPostId: string,
  ): Promise<PlatformComment[]> {
    throw new TierTwoNotApprovedError(this.platform);
  }
  async replyToComment(
    _ctx: AdapterContext,
    _externalCommentId: string,
    _message: string,
  ): Promise<{ externalCommentId: string }> {
    throw new TierTwoNotApprovedError(this.platform);
  }
}

export class TikTokAdapter extends Tier2StubAdapter {
  readonly platform: Platform = 'tiktok';
}
export class YouTubeAdapter extends Tier2StubAdapter {
  readonly platform: Platform = 'youtube';
}
export class LinkedInAdapter extends Tier2StubAdapter {
  readonly platform: Platform = 'linkedin';
}
