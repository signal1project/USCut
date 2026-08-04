export { TrendingResearchService } from './trendingService';
export type {
  TrendSignal,
  RawTrendSignal,
  TrendFetcher,
  TrendingRequest,
  TrendingResponse,
} from './trendingService';
export { GoogleTrendsFetcher } from './googleTrendsFetcher';
export {
  PlatformTrendFetcher,
  extractGoogleNewsTitles,
  type PlatformTrendSource,
} from './platformTrendFetcher';
export {
  AITrendFallback,
  buildTrendPrompt,
  parseTrendResponse,
} from './aiTrendFallback';
export { createResearchRouter } from './router';
export { scrapeContentIdeas } from './contentScraper';
export type { ContentIdea } from './contentScraper';
