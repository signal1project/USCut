import type { Platform } from '@mas/types';
import { axiosHttp, type AdapterHttp } from './http';
import { FacebookAdapter } from './facebookAdapter';
import { InstagramAdapter } from './instagramAdapter';
import { TwitterAdapter } from './twitterAdapter';
import { PinterestAdapter } from './pinterestAdapter';
import { ThreadsAdapter } from './threadsAdapter';
import { TikTokAdapter, YouTubeAdapter, LinkedInAdapter } from './tier2Stubs';
import type { PlatformAdapter } from './types';

// Builds the platform→adapter map: Tier 1 are live; Tier 2 are stubs that throw
// until platform developer approval lands.
export function buildAdapterRegistry(
  http: AdapterHttp = axiosHttp,
): Map<Platform, PlatformAdapter> {
  const registry = new Map<Platform, PlatformAdapter>();
  registry.set('facebook', new FacebookAdapter(http));
  registry.set('instagram', new InstagramAdapter(http));
  registry.set('twitter', new TwitterAdapter(http));
  registry.set('pinterest', new PinterestAdapter(http));
  registry.set('threads', new ThreadsAdapter(http));
  registry.set('tiktok', new TikTokAdapter());
  registry.set('youtube', new YouTubeAdapter());
  registry.set('linkedin', new LinkedInAdapter());
  return registry;
}

let defaultRegistry: Map<Platform, PlatformAdapter> | null = null;

export function getAdapter(platform: Platform): PlatformAdapter {
  if (!defaultRegistry) defaultRegistry = buildAdapterRegistry();
  const adapter = defaultRegistry.get(platform);
  if (!adapter)
    throw new Error(`No platform adapter registered for "${platform}".`);
  return adapter;
}
