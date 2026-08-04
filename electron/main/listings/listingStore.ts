import type { DataSource, Repository } from 'typeorm';
import { PropertyListingModel } from '../../db/models/mas';
import { ComplianceGuard } from './complianceGuard';
import type { ListingCapturePayload, PropertyListingSummary } from './types';

export interface ListListingsParams {
  source?: string;
  state?: string;
  city?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export interface ListingStore {
  capture(payload: ListingCapturePayload): Promise<PropertyListingSummary>;
  list(
    params?: ListListingsParams,
  ): Promise<{ listings: PropertyListingSummary[]; total: number }>;
  get(id: string): Promise<PropertyListingSummary | null>;
  remove(id: string): Promise<boolean>;
}

function toSummary(row: PropertyListingModel): PropertyListingSummary {
  return {
    id: row.id,
    source: row.source,
    mlsNumber: row.mlsNumber,
    address: row.address,
    city: row.city,
    state: row.state,
    zip: row.zip,
    price: row.price,
    beds: row.beds,
    baths: row.baths,
    sqft: row.sqft,
    lotSqft: row.lotSqft,
    yearBuilt: row.yearBuilt,
    propertyType: row.propertyType,
    status: row.status,
    daysOnMarket: row.daysOnMarket,
    description: row.description,
    photoUrls: row.photoUrls ?? [],
    agentName: row.agentName,
    agentPhone: row.agentPhone,
    agentEmail: row.agentEmail,
    listingUrl: row.listingUrl,
    complianceOk: row.complianceOk,
    complianceFlags: row.complianceFlags ?? [],
    capturedAt:
      row.capturedAt instanceof Date
        ? row.capturedAt.toISOString()
        : String(row.capturedAt),
  };
}

export class TypeOrmListingStore implements ListingStore {
  private readonly repo: Repository<PropertyListingModel>;
  private readonly guard = new ComplianceGuard();

  constructor(dataSource: DataSource) {
    this.repo = dataSource.getRepository(PropertyListingModel);
  }

  /**
   * Save a captured listing. Re-capturing the same page (same listingUrl)
   * updates the existing row instead of creating a duplicate.
   */
  async capture(
    payload: ListingCapturePayload,
  ): Promise<PropertyListingSummary> {
    const compliance = this.guard.check(payload.description ?? '');

    const existing = payload.listingUrl
      ? await this.repo.findOne({ where: { listingUrl: payload.listingUrl } })
      : null;

    const row = existing ?? this.repo.create();
    row.source = payload.source;
    row.mlsNumber = payload.mlsNumber ?? null;
    row.address = payload.address;
    row.city = payload.city;
    row.state = payload.state;
    row.zip = payload.zip ?? '';
    row.price = payload.price ?? null;
    row.beds = payload.beds ?? null;
    row.baths = payload.baths ?? null;
    row.sqft = payload.sqft ?? null;
    row.lotSqft = payload.lotSqft ?? null;
    row.yearBuilt = payload.yearBuilt ?? null;
    row.propertyType = payload.propertyType ?? null;
    row.status = payload.status ?? 'active';
    row.daysOnMarket = payload.daysOnMarket ?? null;
    row.description = payload.description ?? null;
    row.photoUrls = payload.photoUrls ?? [];
    row.agentName = payload.agentName ?? null;
    row.agentPhone = payload.agentPhone ?? null;
    row.agentEmail = payload.agentEmail ?? null;
    row.listingUrl = payload.listingUrl ?? null;
    row.complianceOk = compliance.ok;
    row.complianceFlags = compliance.flags;
    row.capturedAt = new Date();

    return toSummary(await this.repo.save(row));
  }

  async list(
    params: ListListingsParams = {},
  ): Promise<{ listings: PropertyListingSummary[]; total: number }> {
    const qb = this.repo.createQueryBuilder('l');
    if (params.source)
      qb.andWhere('l.source = :source', { source: params.source });
    if (params.state) qb.andWhere('l.state = :state', { state: params.state });
    if (params.city)
      qb.andWhere('l.city LIKE :city', { city: `%${params.city}%` });
    if (params.status)
      qb.andWhere('l.status = :status', { status: params.status });

    const total = await qb.getCount();
    const rows = await qb
      .orderBy('l.capturedAt', 'DESC')
      .take(Math.min(params.limit ?? 50, 200))
      .skip(params.offset ?? 0)
      .getMany();

    return { listings: rows.map(toSummary), total };
  }

  async get(id: string): Promise<PropertyListingSummary | null> {
    const row = await this.repo.findOne({ where: { id } });
    return row ? toSummary(row) : null;
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.repo.delete({ id });
    return (result.affected ?? 0) > 0;
  }
}
