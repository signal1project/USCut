import { AccountModel } from './models/account';
import { UserModel } from './models/user';
import { PubRecordModel } from './models/pubRecord';
import { VideoModel } from './models/video';
import { AutoRunModel } from './models/autoRun';
import { AutoRunRecordModel } from './models/autoRunRecord';
import { ImgTextModel } from './models/imgText';
import { ReplyCommentRecordModel } from './models/replyCommentRecord';
import { InteractionRecordModel } from './models/interactionRecord';
import { AccountGroupModel } from './models/accountGroup';
import {
  ConnectedAccountModel,
  ContentAssetModel,
  PublishHistoryModel,
  ScheduledPostModel,
  EngagementQueueItemModel,
  AnalyticsSnapshotModel,
  AuditLogModel,
  TrendSignalModel,
  CampaignPackageModel,
  PropertyListingModel,
} from './models/mas';

export const databaseEntities = [
  AccountModel,
  UserModel,
  PubRecordModel,
  VideoModel,
  AutoRunModel,
  AutoRunRecordModel,
  ImgTextModel,
  ReplyCommentRecordModel,
  InteractionRecordModel,
  AccountGroupModel,
  ConnectedAccountModel,
  ContentAssetModel,
  PublishHistoryModel,
  ScheduledPostModel,
  EngagementQueueItemModel,
  AnalyticsSnapshotModel,
  AuditLogModel,
  TrendSignalModel,
  CampaignPackageModel,
  PropertyListingModel,
];
