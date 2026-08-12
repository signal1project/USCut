import type { Platform, PubType, AIProviderName } from '@mas/types';

export interface AgentAdapterInfo {
  id: string;
  label: string;
  kind: 'hermes' | 'mock' | 'external';
}

export interface AgentAdaptersResponse {
  defaultAdapterId: string;
  adapters: AgentAdapterInfo[];
}

export interface WorkflowCampaignPackageRequest {
  campaignTitle: string;
  objective: string;
  niche: string;
  platforms: Platform[];
  approvalMode?: 'dale_required' | 'omobono_only' | 'autopublish_allowed';
  tone?: string;
}

export interface CampaignPackageSummary {
  id: string;
  campaignId: string;
  campaignTitle: string;
  objective: string;
  niche: string;
  platforms: Platform[];
  status:
    | 'needs_approval'
    | 'approved'
    | 'scheduled'
    | 'published'
    | 'rejected';
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowCampaignPackageResult {
  workflowId: string;
  campaignId: string;
  campaignTitle: string;
  objective: string;
  createdAt: string;
  agent: {
    agentId: string;
    kind: string;
    status: string;
    summary: string;
  };
  trendBrief: {
    niche: string;
    signals: TrendSignal[];
    sources: string[];
    cachedUntil: string;
  };
  platformPlaybooks: AlgorithmHints[];
  content: GenerateResult;
  capcutPackage: {
    id: string;
    status: string;
    editingMode: string;
    manifestFileName: string;
    scenes: Array<{
      id: string;
      onScreenText: string;
      voiceover: string;
      durationSeconds: number;
    }>;
    exports: Array<{
      platform: Platform;
      aspectRatio: string;
      resolution: string;
      caption: string;
      hashtags: string[];
    }>;
  };
  publishingPlan: {
    status: string;
    approvalMode: string;
    gates: string[];
    platforms: Platform[];
  };
  persistedPackage?: CampaignPackageSummary;
  publishingFeedback?: Array<{
    platform: Platform;
    externalPostId: string;
    accountId?: string;
    publishedAt: string;
    analyticsStatus: 'pending_capture' | 'captured';
    notes?: string;
  }>;
}

export interface MasApiClientOptions {
  baseUrl: string;
  token: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export interface PublishRequestBody {
  accountIds: string[];
  pubType: PubType;
  body?: string;
  hashtags?: string[];
  mediaRefs?: string[];
  contentAssetId?: string | null;
  runAt?: string;
}

export interface AccountPublishResult {
  accountId: string;
  status: string;
  externalPostId?: string;
  error?: string;
  historyId: string;
}
export interface PublishOutcome {
  status: string;
  results: AccountPublishResult[];
}
export interface ScheduleAccepted {
  scheduled: true;
  scheduledPostIds: string[];
}

export interface GeneratedContent {
  platform: Platform;
  body: string;
  hashtags: string[];
  variant?: number;
}
export interface GenerateResult {
  provider: string;
  items: GeneratedContent[];
}

export interface CarouselSlide {
  index: number;
  title: string;
  body: string;
  imagePrompt: string;
}

export interface CarouselResult {
  provider: string;
  platform: Platform;
  caption: string;
  hashtags: string[];
  slides: CarouselSlide[];
}

// ── Insights ──────────────────────────────────────────────────────────────────

export interface CalendarEntry {
  id: string;
  accountId: string;
  platform: string;
  runAt: string;
  status: string;
  body: string;
}

export interface BestTimeSlotInfo {
  dayOfWeek: number;
  hour: number;
  avgEngagements: number;
  sampleSize: number;
  label: string;
  nextOccurrence: string;
}

export interface BestTimesResult {
  slots: BestTimeSlotInfo[];
  basedOn: 'history' | 'defaults';
  sampleSize: number;
}

export interface RecycleOutcome {
  requeued: Array<{
    sourcePostId: string;
    accountId: string;
    platform: string;
    runAt: string;
    scheduledPostIds: string[];
  }>;
  skipped: number;
}

export interface CompetitorEntry {
  id: string;
  name: string;
  platform: string;
  handle: string;
  notes: string;
  snapshots: Array<{
    date: string;
    followers: number;
    engagementRate?: number;
  }>;
}

export interface ListingVideoResult {
  listingId: string;
  path: string;
  durationSeconds: number;
  photosUsed: number;
  narrated: boolean;
}

export interface AutoClipResult {
  transcriptSource: 'provided' | 'whisper';
  pickedBy: 'ai' | 'heuristic';
  clips: Array<{
    path: string;
    start: number;
    end: number;
    durationSeconds: number;
    hook: string;
  }>;
}

export interface AnalyticsSnapshot {
  id: string;
  accountId: string;
  platform: Platform;
  externalPostId: string;
  reach: number;
  impressions: number;
  engagements: number;
  clicks: number;
  capturedAt: string;
}

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
  status: string;
}

// ── Accounts ─────────────────────────────────────────────────────────────────

export interface ConnectedAccountSummary {
  id: string;
  platform: Platform;
  accountName: string;
  externalId: string;
  status: string;
  /** 'webview' = detected via the signed-in browser session, no OAuth token
   * — must post through the webview composer, never the API publish engine. */
  source?: string;
  /** Company (BrandProfile id) this account/Page is assigned to, or null if
   * unassigned. Used to filter the account list to the active company. */
  brandId?: string | null;
}

// ── Research ──────────────────────────────────────────────────────────────────

export interface TrendSignal {
  id: string;
  source: string;
  keyword: string;
  hashtags: string[];
  trafficScore: number | null;
  nicheScore: number;
  niche: string;
  fetchedAt: string;
  expiresAt: string;
}

export interface TrendingResponse {
  signals: TrendSignal[];
  cachedUntil: string;
  sources: string[];
}

export interface ContentIdea {
  title: string;
  source: string;
  link: string;
  publishedAt: string | null;
  snippet: string;
}

export interface ScrapeResponse {
  keyword: string;
  ideas: ContentIdea[];
}

// ── Listing Scraper ───────────────────────────────────────────────────────────

export interface ComplianceFlagInfo {
  rule: string;
  severity: string;
  matched: string;
  detail: string;
}

export interface PropertyListingSummary {
  id: string;
  source: string;
  mlsNumber: string | null;
  address: string;
  city: string;
  state: string;
  zip: string;
  price: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  lotSqft: number | null;
  yearBuilt: number | null;
  propertyType: string | null;
  status: string;
  daysOnMarket: number | null;
  description: string | null;
  photoUrls: string[];
  agentName: string | null;
  agentPhone: string | null;
  agentEmail: string | null;
  listingUrl: string | null;
  complianceOk: boolean;
  complianceFlags: ComplianceFlagInfo[];
  capturedAt: string;
}

export interface ListListingsResponse {
  listings: PropertyListingSummary[];
  total: number;
}

export interface ListingAdItem {
  platform: Platform;
  body: string;
  hashtags: string[];
  complianceOk: boolean;
  complianceFlags: ComplianceFlagInfo[];
}

export interface ListingAdResult {
  listingId: string;
  provider: string;
  items: ListingAdItem[];
}

// ── Algorithm ─────────────────────────────────────────────────────────────────

export interface AlgorithmHints {
  platform: Platform;
  summary: string;
  topFormat: string;
  optimalTimes: string[];
  hashtagStrategy: string;
  topRewardSignals: string[];
  hookAdvice: string;
  bonusTips: string[];
  promptHint: string;
}

// ── AI Provider Status ────────────────────────────────────────────────────────

export interface AIProviderStatus {
  name: AIProviderName;
  label: string;
  authMethod: 'api_key' | 'oauth_key' | 'oauth_token' | 'local';
  supportsImages: boolean;
  dashboardUrl: string;
  isConfigured: boolean;
  isActive: boolean;
  model: string | null;
  ollamaBaseUrl: string | null;
}

export interface SettingsStatus {
  activeProvider: AIProviderName | null;
  imageReady: boolean;
  providers: AIProviderStatus[];
}

export class MasApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'MasApiError';
  }
}

/**
 * Typed client for the embedded API. The Electron main process provides baseUrl
 * + token (via preload); the renderer and the Hermes MCP server both use this.
 */
export class MasApiClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: MasApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  private async req<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const parsed = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const message =
        parsed && typeof parsed === 'object' && 'error' in parsed
          ? String((parsed as { error: unknown }).error)
          : `request_failed_${res.status}`;
      throw new MasApiError(message, res.status, parsed);
    }
    return parsed as T;
  }

  health(): Promise<{ status: string }> {
    return this.req('GET', '/health');
  }

  publish(
    body: PublishRequestBody,
  ): Promise<PublishOutcome | ScheduleAccepted> {
    return this.req('POST', '/api/publish', body);
  }

  generateContent(body: {
    brief: string;
    platforms: Platform[];
    tone?: string;
    variants?: number;
  }): Promise<GenerateResult> {
    return this.req('POST', '/api/content/generate', body);
  }

  generateCarousel(body: {
    brief: string;
    platform: Platform;
    slideCount?: number;
    tone?: string;
  }): Promise<CarouselResult> {
    return this.req('POST', '/api/content/carousel', body);
  }

  generateImage(body: {
    prompt: string;
    width?: number;
    height?: number;
  }): Promise<{ url: string }> {
    return this.req('POST', '/api/content/image', body);
  }

  captureAnalytics(body: {
    accountId: string;
    externalPostId: string;
  }): Promise<AnalyticsSnapshot> {
    return this.req('POST', '/api/analytics/capture', body);
  }

  getAnalyticsByAccount(
    accountId: string,
  ): Promise<{ snapshots: AnalyticsSnapshot[] }> {
    return this.req(
      'GET',
      `/api/analytics?accountId=${encodeURIComponent(accountId)}`,
    );
  }

  ingestComments(body: {
    accountId: string;
    externalPostId: string;
  }): Promise<{ items: EngagementItem[] }> {
    return this.req('POST', '/api/engagement/ingest', body);
  }

  listPendingEngagement(): Promise<{ items: EngagementItem[] }> {
    return this.req('GET', '/api/engagement/pending');
  }

  updateEngagementDraft(
    id: string,
    draftReply: string,
  ): Promise<{ ok: boolean }> {
    return this.req(
      'PATCH',
      `/api/engagement/${encodeURIComponent(id)}/draft`,
      { draftReply },
    );
  }

  approveEngagement(
    id: string,
    overrideText?: string,
  ): Promise<{ externalCommentId: string }> {
    return this.req(
      'POST',
      `/api/engagement/${encodeURIComponent(id)}/approve`,
      { overrideText },
    );
  }

  dismissEngagement(id: string): Promise<{ ok: boolean }> {
    return this.req(
      'POST',
      `/api/engagement/${encodeURIComponent(id)}/dismiss`,
      {},
    );
  }

  // ── Trending Research ───────────────────────────────────────────────────────

  scrapeContent(keyword: string): Promise<ScrapeResponse> {
    return this.req(
      'GET',
      `/api/research/scrape?keyword=${encodeURIComponent(keyword)}`,
    );
  }

  getTrending(params?: {
    niche?: string;
    sources?: string[];
    limit?: number;
  }): Promise<TrendingResponse> {
    const qs = new URLSearchParams();
    if (params?.niche) qs.set('niche', params.niche);
    if (params?.sources) qs.set('sources', params.sources.join(','));
    if (params?.limit) qs.set('limit', String(params.limit));
    const query = qs.toString() ? `?${qs.toString()}` : '';
    return this.req('GET', `/api/research/trending${query}`);
  }

  // ── Listing Scraper ─────────────────────────────────────────────────────────

  listListings(params?: {
    source?: string;
    state?: string;
    city?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<ListListingsResponse> {
    const qs = new URLSearchParams();
    if (params?.source) qs.set('source', params.source);
    if (params?.state) qs.set('state', params.state);
    if (params?.city) qs.set('city', params.city);
    if (params?.status) qs.set('status', params.status);
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    const query = qs.toString() ? `?${qs.toString()}` : '';
    return this.req('GET', `/api/listings${query}`);
  }

  getListing(id: string): Promise<{ listing: PropertyListingSummary }> {
    return this.req('GET', `/api/listings/${encodeURIComponent(id)}`);
  }

  deleteListing(id: string): Promise<{ ok: boolean }> {
    return this.req('DELETE', `/api/listings/${encodeURIComponent(id)}`);
  }

  generateListingAd(
    id: string,
    body: { platforms: Platform[]; tone?: string; highlight?: string },
  ): Promise<ListingAdResult> {
    return this.req(
      'POST',
      `/api/listings/${encodeURIComponent(id)}/generate-ad`,
      body,
    );
  }

  generateListingVideo(
    id: string,
    body: {
      maxPhotos?: number;
      secondsPerPhoto?: number;
      narration?: boolean;
    } = {},
  ): Promise<ListingVideoResult> {
    return this.req(
      'POST',
      `/api/listings/${encodeURIComponent(id)}/generate-video`,
      body,
    );
  }

  captureListingUrl(url: string): Promise<{ listing: PropertyListingSummary }> {
    return this.req('POST', '/api/listings/capture-url', { url });
  }

  // ── Clips ───────────────────────────────────────────────────────────────────

  autoClip(body: {
    videoPath: string;
    transcriptSrt?: string;
    maxClips?: number;
    clipSeconds?: number;
    vertical?: boolean;
    burnCaptions?: boolean;
  }): Promise<AutoClipResult> {
    return this.req('POST', '/api/clips/auto', body);
  }

  // ── Insights ────────────────────────────────────────────────────────────────

  getCalendar(
    from?: string,
    to?: string,
  ): Promise<{ entries: CalendarEntry[] }> {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    const query = qs.toString() ? `?${qs.toString()}` : '';
    return this.req('GET', `/api/insights/calendar${query}`);
  }

  getBestTimes(platform?: string): Promise<BestTimesResult> {
    const query = platform ? `?platform=${encodeURIComponent(platform)}` : '';
    return this.req('GET', `/api/insights/best-times${query}`);
  }

  recycleTopPosts(
    body: { count?: number; spacingHours?: number } = {},
  ): Promise<RecycleOutcome> {
    return this.req('POST', '/api/insights/recycle', {
      count: 3,
      spacingHours: 24,
      ...body,
    });
  }

  listCompetitors(): Promise<{ competitors: CompetitorEntry[] }> {
    return this.req('GET', '/api/insights/competitors');
  }

  addCompetitor(body: {
    name: string;
    platform: string;
    handle: string;
    notes?: string;
  }): Promise<{ competitor: CompetitorEntry }> {
    return this.req('POST', '/api/insights/competitors', {
      notes: '',
      ...body,
    });
  }

  addCompetitorSnapshot(
    id: string,
    body: { followers: number; engagementRate?: number },
  ): Promise<{ competitor: CompetitorEntry }> {
    return this.req(
      'POST',
      `/api/insights/competitors/${encodeURIComponent(id)}/snapshot`,
      body,
    );
  }

  deleteCompetitor(id: string): Promise<{ ok: boolean }> {
    return this.req(
      'DELETE',
      `/api/insights/competitors/${encodeURIComponent(id)}`,
    );
  }

  generateBioPage(body: {
    name: string;
    tagline?: string;
    brokerage?: string;
    phone?: string;
    email?: string;
    accentColor?: string;
    links: Array<{ label: string; url: string }>;
    listings?: Array<{
      address: string;
      price?: string;
      specs?: string;
      url?: string;
      photoUrl?: string;
    }>;
  }): Promise<{ path: string; bytes: number }> {
    return this.req('POST', '/api/insights/bio-page', body);
  }

  // ── Platform Algorithm ──────────────────────────────────────────────────────

  getAlgorithmHints(platforms?: Platform[]): Promise<AlgorithmHints[]> {
    const query = platforms ? `?platforms=${platforms.join(',')}` : '';
    return this.req('GET', `/api/algorithm/hints${query}`);
  }

  getAlgorithmHint(platform: Platform): Promise<AlgorithmHints> {
    return this.req('GET', `/api/algorithm/hints?platform=${platform}`);
  }

  listAgentAdapters(): Promise<AgentAdaptersResponse> {
    return this.req('GET', '/api/agent/adapters');
  }

  createCampaignPackage(
    body: WorkflowCampaignPackageRequest,
  ): Promise<WorkflowCampaignPackageResult> {
    return this.req('POST', '/api/workflow/campaign-package', body);
  }

  listCampaignPackages(params?: {
    status?: CampaignPackageSummary['status'];
    limit?: number;
  }): Promise<{ packages: CampaignPackageSummary[] }> {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.limit) qs.set('limit', String(params.limit));
    const query = qs.toString() ? `?${qs.toString()}` : '';
    return this.req('GET', `/api/workflow/campaign-packages${query}`);
  }

  updateCampaignPackageStatus(
    id: string,
    status: CampaignPackageSummary['status'],
  ): Promise<CampaignPackageSummary> {
    return this.req(
      'PATCH',
      `/api/workflow/campaign-packages/${encodeURIComponent(id)}/status`,
      { status },
    );
  }

  recordPublicationFeedback(
    id: string,
    body: {
      platform: Platform;
      externalPostId: string;
      accountId?: string;
      publishedAt?: string;
      notes?: string;
    },
  ): Promise<CampaignPackageSummary> {
    return this.req(
      'POST',
      `/api/workflow/campaign-packages/${encodeURIComponent(id)}/publication-feedback`,
      body,
    );
  }
}
