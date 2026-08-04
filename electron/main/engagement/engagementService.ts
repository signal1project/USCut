import {
  AuditAction,
  EngagementStatus,
  type AIProvider,
  type Platform,
} from '@mas/types';
import type {
  AccountStore,
  AdapterResolver,
  AuditStore,
  QueueRunner,
  TokenResolver,
} from '../publishEngine/ports';

export interface EngagementItem {
  id: string;
  accountId: string;
  platform: Platform;
  externalCommentId: string;
  externalPostId: string;
  authorHandle: string;
  commentText: string;
  draftReply: string;
  highConversion: boolean;
  status: EngagementStatus;
}

export interface EngagementStore {
  create(input: Omit<EngagementItem, 'id'>): Promise<EngagementItem>;
  getById(id: string): Promise<EngagementItem | null>;
  update(
    id: string,
    patch: Partial<Pick<EngagementItem, 'status' | 'draftReply'>>,
  ): Promise<void>;
  existsByExternalCommentId(externalCommentId: string): Promise<boolean>;
  listByStatus(status: EngagementStatus): Promise<EngagementItem[]>;
}

export interface EngagementServiceDeps {
  accounts: AccountStore;
  store: EngagementStore;
  audit: AuditStore;
  resolveToken: TokenResolver;
  resolveAdapter: AdapterResolver;
  resolveProvider: () => AIProvider;
  queue: QueueRunner;
}

// Comment phrases that signal buying intent — flagged for priority human review.
const HIGH_CONVERSION_PATTERNS = [
  /\bprice\b/i,
  /\bhow much\b/i,
  /\bcost\b/i,
  /\bbuy\b/i,
  /\bpurchase\b/i,
  /\binterested\b/i,
  /\bavailable\b/i,
  /\bin stock\b/i,
  /\bdm\b/i,
  /\blink\b/i,
  /\bwhere can i\b/i,
];

export function detectHighConversion(text: string): boolean {
  return HIGH_CONVERSION_PATTERNS.some((re) => re.test(text));
}

function replyPrompt(comment: string): string {
  return (
    `A follower commented: "${comment}". Write a friendly, concise reply that ` +
    `encourages further engagement. Do not invent specific prices or promises.`
  );
}

/**
 * Assisted engagement: pulls comments from a post, drafts an AI reply for each,
 * flags high-conversion intent, and queues them for human approval. Nothing is
 * posted until a human approves — replies never go out automatically.
 */
export class EngagementService {
  constructor(private readonly deps: EngagementServiceDeps) {}

  async ingestComments(
    accountId: string,
    externalPostId: string,
  ): Promise<EngagementItem[]> {
    const account = await this.deps.accounts.getById(accountId);
    if (!account) throw new Error(`account_not_found: ${accountId}`);

    const token = await this.deps.resolveToken(account);
    const adapter = this.deps.resolveAdapter(account.platform);
    const ctx = {
      accessToken: token,
      externalId: account.externalId,
      meta: account.metadata,
    };
    const comments = await this.deps.queue.run(account.platform, () =>
      adapter.fetchComments(ctx, externalPostId),
    );

    const provider = this.deps.resolveProvider();
    const created: EngagementItem[] = [];
    for (const c of comments) {
      if (await this.deps.store.existsByExternalCommentId(c.externalCommentId))
        continue;
      const draftReply = await provider.generateText(replyPrompt(c.text), {
        platform: account.platform,
      });
      const item = await this.deps.store.create({
        accountId,
        platform: account.platform,
        externalCommentId: c.externalCommentId,
        externalPostId,
        authorHandle: c.authorHandle,
        commentText: c.text,
        draftReply,
        highConversion: detectHighConversion(c.text),
        status: EngagementStatus.PENDING,
      });
      created.push(item);
    }
    return created;
  }

  listPending(): Promise<EngagementItem[]> {
    return this.deps.store.listByStatus(EngagementStatus.PENDING);
  }

  /** Human edits the draft before approving. */
  async updateDraft(itemId: string, draftReply: string): Promise<void> {
    const item = await this.deps.store.getById(itemId);
    if (!item) throw new Error(`engagement_item_not_found: ${itemId}`);
    await this.deps.store.update(itemId, { draftReply });
  }

  /** Post the (optionally overridden) reply and mark approved. */
  async approveAndReply(
    itemId: string,
    overrideText?: string,
  ): Promise<{ externalCommentId: string }> {
    const item = await this.deps.store.getById(itemId);
    if (!item) throw new Error(`engagement_item_not_found: ${itemId}`);
    if (item.status !== EngagementStatus.PENDING) {
      throw new Error(`engagement_item_not_pending: ${itemId}`);
    }

    const account = await this.deps.accounts.getById(item.accountId);
    if (!account) throw new Error(`account_not_found: ${item.accountId}`);

    const reply = (overrideText ?? item.draftReply).trim();
    if (!reply) throw new Error('reply_text_empty');

    const token = await this.deps.resolveToken(account);
    const adapter = this.deps.resolveAdapter(account.platform);
    const ctx = {
      accessToken: token,
      externalId: account.externalId,
      meta: account.metadata,
    };
    try {
      const result = await this.deps.queue.run(account.platform, () =>
        adapter.replyToComment(ctx, item.externalCommentId, reply),
      );
      await this.deps.store.update(itemId, {
        status: EngagementStatus.APPROVED,
        draftReply: reply,
      });
      await this.deps.audit.record(
        AuditAction.ENGAGE,
        'mas_engagement_queue',
        itemId,
        {
          accountId: item.accountId,
          platform: item.platform,
          externalCommentId: item.externalCommentId,
        },
      );
      return result;
    } catch (err) {
      await this.deps.store.update(itemId, { status: EngagementStatus.FAILED });
      throw err;
    }
  }

  async dismiss(itemId: string): Promise<void> {
    const item = await this.deps.store.getById(itemId);
    if (!item) throw new Error(`engagement_item_not_found: ${itemId}`);
    await this.deps.store.update(itemId, {
      status: EngagementStatus.DISMISSED,
    });
  }
}
