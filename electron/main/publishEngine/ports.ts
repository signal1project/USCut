import type { AuditAction, Platform, PubStatus, PubType } from '@mas/types';
import type { PlatformAdapter } from '../adapters/types';

// Minimal account view the engine needs (no token material — that's resolved separately).
export interface EngineAccount {
  id: string;
  platform: Platform;
  externalId: string;
  credentialRef: string;
  metadata?: Record<string, unknown>;
}

export interface PublishHistoryRecord {
  id: string;
  accountId: string;
  platform: Platform;
  contentAssetId: string | null;
  status: PubStatus;
  externalPostId: string;
  error: string;
  attempts: number;
  publishedAt: Date | null;
}

export interface ScheduledPostRecord {
  id: string;
  accountId: string;
  platform: Platform;
  contentAssetId: string;
  runAt: Date;
  status: PubStatus;
}

// ── Ports the engine depends on (TypeORM-backed in prod, faked in tests) ──

export interface AccountStore {
  getById(id: string): Promise<EngineAccount | null>;
}

export interface PublishHistoryStore {
  create(input: {
    accountId: string;
    platform: Platform;
    contentAssetId: string | null;
    status: PubStatus;
    attempts: number;
  }): Promise<PublishHistoryRecord>;
  update(
    id: string,
    patch: Partial<
      Pick<
        PublishHistoryRecord,
        'status' | 'externalPostId' | 'error' | 'publishedAt'
      >
    >,
  ): Promise<void>;
  list(filter?: {
    platform?: Platform;
    status?: PubStatus;
    limit?: number;
  }): Promise<PublishHistoryRecord[]>;
}

export interface ScheduledPostStore {
  create(input: {
    accountId: string;
    platform: Platform;
    contentAssetId: string;
    runAt: Date;
    status: PubStatus;
  }): Promise<ScheduledPostRecord>;
  update(
    id: string,
    patch: Partial<Pick<ScheduledPostRecord, 'status'>>,
  ): Promise<void>;
  list(platform?: Platform): Promise<ScheduledPostRecord[]>;
  /** Removes the row outright (a cancelled post has no useful terminal status to keep). */
  remove(id: string): Promise<boolean>;
}

export interface AuditStore {
  record(
    action: AuditAction,
    entity: string,
    entityId: string,
    details: Record<string, unknown>,
  ): Promise<void>;
}

// Resolves a fresh access token for an account (wraps OAuth ensureFresh + settings).
export type TokenResolver = (account: EngineAccount) => Promise<string>;

// Resolves the adapter for a platform (wraps the registry).
export type AdapterResolver = (platform: Platform) => PlatformAdapter;

// Runs a task through the platform's rate-limited queue.
export interface QueueRunner {
  run<T>(platform: Platform, task: () => Promise<T>): Promise<T>;
}

export interface PublishContentInput {
  pubType: PubType;
  body: string;
  hashtags: string[];
  mediaUrls: string[];
  contentAssetId?: string | null;
}
