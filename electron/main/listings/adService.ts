import type { Platform } from '@mas/types';
import type { ContentService } from '../content';
import { ComplianceGuard, type ComplianceFlag } from './complianceGuard';
import type { ListingStore } from './listingStore';
import type { PropertyListingSummary } from './types';

export interface ListingAdItem {
  platform: Platform;
  body: string;
  hashtags: string[];
  complianceOk: boolean;
  complianceFlags: ComplianceFlag[];
}

export interface ListingAdResult {
  listingId: string;
  /** AI provider used, or "template" when no provider is configured. */
  provider: string;
  items: ListingAdItem[];
}

export interface GenerateListingAdOptions {
  platforms: Platform[];
  tone?: string;
  /** Agent's custom highlight, e.g. "new roof, updated kitchen". */
  highlight?: string;
}

function formatPrice(cents: number | null): string {
  if (!cents) return 'price upon request';
  const dollars = cents / 100;
  return dollars >= 1_000_000
    ? `$${(dollars / 1_000_000).toFixed(2)}M`
    : `$${dollars.toLocaleString()}`;
}

function specLine(l: PropertyListingSummary): string {
  return [
    l.beds ? `${l.beds}bd` : null,
    l.baths ? `${l.baths}ba` : null,
    l.sqft ? `${l.sqft.toLocaleString()} sqft` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Brief handed to ContentService (which layers on platform length limits,
 * tone, and algorithm hints). Fair Housing / RESPA constraints are stated
 * in the prompt AND enforced after generation by ComplianceGuard.
 */
export function buildListingBrief(
  l: PropertyListingSummary,
  opts: GenerateListingAdOptions,
): string {
  return `Write a real estate listing ad for this property.

LISTING DETAILS:
- Address: ${l.address}, ${l.city}, ${l.state} ${l.zip}
- Price: ${formatPrice(l.price)}
- Specs: ${specLine(l) || 'see description'}
- Type: ${l.propertyType ?? 'residential'}
- Days on market: ${l.daysOnMarket ?? 'new listing'}
${opts.highlight ? `- Agent highlight: ${opts.highlight}` : ''}
${l.description ? `- Description: ${l.description.slice(0, 300)}` : ''}

REQUIREMENTS:
- Do NOT include any language about race, religion, national origin, sex, familial status, or disability (Fair Housing Act) — describe the property, never the buyer
- Do NOT mention referral fees or kickbacks (RESPA)
- Include a clear call-to-action (DM for details, schedule a showing, link in bio)
- Include relevant real estate hashtags at the end`;
}

const TEMPLATE_HASHTAGS: Record<Platform, string> = {
  facebook: '#RealEstate #JustListed #HomesForSale',
  instagram:
    '#RealEstate #JustListed #HomesForSale #DreamHome #NewListing #HouseHunting #Realtor #ForSale #HouseGoals #PropertySearch',
  twitter: '#RealEstate #JustListed',
  threads: '#RealEstate #JustListed #NewListing',
  pinterest: '#RealEstate #DreamHome #HomesForSale #HouseGoals',
  youtube: '#RealEstate #JustListed #HomeTour',
  tiktok: '#RealEstate #JustListed #HouseTour #FYP',
  linkedin:
    '#RealEstate #JustListed #HomesForSale #PropertyInvestment #Realtor',
};

/** Deterministic fallback so listing ads work with no AI provider configured. */
export function buildListingTemplate(
  l: PropertyListingSummary,
  platform: Platform,
  highlight?: string,
): string {
  const lines = [
    `🏠 New Listing Alert! ${l.address}, ${l.city}, ${l.state}`,
    l.price ? `💰 Listed at ${formatPrice(l.price)}` : '',
    specLine(l) ? `📐 ${specLine(l)}` : '',
    highlight ? `✨ ${highlight}` : '',
    '',
    platform === 'twitter'
      ? 'DM for details!'
      : 'Schedule your private showing today — DM us or call to book!',
  ];
  const base = lines.filter(Boolean).join('\n');
  return `${base}\n\n${TEMPLATE_HASHTAGS[platform]}`;
}

function extractHashtags(text: string): string[] {
  const matches = text.match(/#[\p{L}0-9_]+/gu) ?? [];
  return [...new Set(matches)].map((h) => h.slice(1));
}

/**
 * Turns a captured listing into platform-ready ad copy: AI provider when one
 * is configured (via ContentService, algorithm-hint aware), template fallback
 * otherwise. Every variant is compliance-checked AFTER generation — flagged
 * copy is returned (so the agent can see why) but marked complianceOk:false,
 * and the UI/publish flow must treat that as blocked.
 */
export class ListingAdService {
  private readonly guard = new ComplianceGuard();

  constructor(
    private readonly store: ListingStore,
    private readonly content: ContentService,
  ) {}

  async generateAd(
    listingId: string,
    opts: GenerateListingAdOptions,
  ): Promise<ListingAdResult | null> {
    const listing = await this.store.get(listingId);
    if (!listing) return null;

    let provider = 'template';
    let raw: Array<{ platform: Platform; body: string }> = [];

    try {
      const result = await this.content.generate({
        brief: buildListingBrief(listing, opts),
        platforms: opts.platforms,
        tone: opts.tone ?? 'professional',
      });
      provider = result.provider;
      raw = result.items.map((i) => ({ platform: i.platform, body: i.body }));
    } catch {
      // No AI provider configured (or provider error) — deterministic fallback.
      raw = opts.platforms.map((platform) => ({
        platform,
        body: buildListingTemplate(listing, platform, opts.highlight),
      }));
    }

    const items: ListingAdItem[] = raw.map(({ platform, body }) => {
      const compliance = this.guard.check(body);
      return {
        platform,
        body,
        hashtags: extractHashtags(body),
        complianceOk: compliance.ok,
        complianceFlags: compliance.flags,
      };
    });

    return { listingId, provider, items };
  }
}
