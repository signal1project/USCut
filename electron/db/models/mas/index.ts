// MAS schema layer — US-platform OAuth model, aligned with @mas/types Zod schemas.
// Tables are prefixed `mas_` to coexist with the legacy (cookie-based) models.
export { ConnectedAccountModel } from './connectedAccount';
export { ContentAssetModel } from './contentAsset';
export { PublishHistoryModel } from './publishHistory';
export { ScheduledPostModel } from './scheduledPost';
export { EngagementQueueItemModel } from './engagementQueueItem';
export { AnalyticsSnapshotModel } from './analyticsSnapshot';
export { AuditLogModel } from './auditLog';
export { TrendSignalModel } from './trendSignal';
export {
  CampaignPackageModel,
  type CampaignPackageStatus,
} from './campaignPackage';
export { PropertyListingModel } from './propertyListing';
