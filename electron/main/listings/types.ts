/**
 * Listing Scraper — shared types.
 * Mirrors the capture payload sent by the Chrome extension
 * (chrome-extension/utils/overlay.ts) for Zillow / Realtor.com / Redfin.
 */

export type ListingSource = 'zillow' | 'realtor' | 'redfin' | 'manual';

export interface ListingCapturePayload {
  source: ListingSource;
  mlsNumber?: string;
  address: string;
  city: string;
  state: string;
  zip?: string;
  /** List price in cents. */
  price?: number;
  beds?: number;
  baths?: number;
  sqft?: number;
  lotSqft?: number;
  yearBuilt?: number;
  propertyType?: string;
  status?: string;
  daysOnMarket?: number;
  description?: string;
  photoUrls?: string[];
  agentName?: string;
  agentPhone?: string;
  agentEmail?: string;
  listingUrl?: string;
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
  complianceFlags: Array<{
    rule: string;
    severity: string;
    matched: string;
    detail: string;
  }>;
  capturedAt: string;
}
