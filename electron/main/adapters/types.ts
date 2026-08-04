import type { Platform, PubType } from '@mas/types';

// Resolved auth + account context for a single adapter call. The OAuth/credential
// layer produces accessToken (already fresh); externalId is the platform account
// or page id the operation targets.
export interface AdapterContext {
  accessToken: string;
  externalId: string;
  meta?: Record<string, unknown>;
}

// Normalized publish input — media is pre-resolved to publicly fetchable URLs.
export interface PublishInput {
  pubType: PubType;
  body: string;
  hashtags: string[];
  mediaUrls: string[];
}

export interface PublishResult {
  externalPostId: string;
}

export interface PostMetrics {
  reach: number;
  impressions: number;
  engagements: number;
  clicks: number;
}

export interface PlatformComment {
  externalCommentId: string;
  externalPostId: string;
  authorHandle: string;
  text: string;
}

/**
 * Uniform surface every platform integration implements. The publish engine,
 * analytics service, and engagement queue depend only on this — never on a
 * specific platform's API shape.
 */
export interface PlatformAdapter {
  readonly platform: Platform;
  publish(ctx: AdapterContext, input: PublishInput): Promise<PublishResult>;
  fetchMetrics(
    ctx: AdapterContext,
    externalPostId: string,
  ): Promise<PostMetrics>;
  fetchComments(
    ctx: AdapterContext,
    externalPostId: string,
  ): Promise<PlatformComment[]>;
  replyToComment(
    ctx: AdapterContext,
    externalCommentId: string,
    message: string,
  ): Promise<{ externalCommentId: string }>;
}
