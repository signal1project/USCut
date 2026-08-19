import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Property listing captured by the Listing Scraper Chrome extension
 * (Zillow / Realtor.com / Redfin) or created manually via the API.
 * Feeds listing-ad content generation; complianceFlags carries any
 * Fair Housing / RESPA warnings detected in the listing description.
 */
@Entity({ name: 'mas_property_listing' })
export class PropertyListingModel {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Capture source: "zillow" | "realtor" | "redfin" | "manual". */
  @Index()
  @Column({ type: 'varchar' })
  source!: string;

  @Column({ type: 'varchar', nullable: true })
  mlsNumber!: string | null;

  @Column({ type: 'varchar' })
  address!: string;

  @Index()
  @Column({ type: 'varchar' })
  city!: string;

  @Index()
  @Column({ type: 'varchar' })
  state!: string;

  @Column({ type: 'varchar', default: '' })
  zip!: string;

  /** List price in cents (null when the page didn't expose one). */
  @Column({ type: 'integer', nullable: true })
  price!: number | null;

  @Column({ type: 'float', nullable: true })
  beds!: number | null;

  @Column({ type: 'float', nullable: true })
  baths!: number | null;

  @Column({ type: 'integer', nullable: true })
  sqft!: number | null;

  @Column({ type: 'integer', nullable: true })
  lotSqft!: number | null;

  @Column({ type: 'integer', nullable: true })
  yearBuilt!: number | null;

  @Column({ type: 'varchar', nullable: true })
  propertyType!: string | null;

  /** Listing status: "active" | "pending" | "sold". */
  @Index()
  @Column({ type: 'varchar', default: 'active' })
  status!: string;

  @Column({ type: 'integer', nullable: true })
  daysOnMarket!: number | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'simple-json', default: '[]' })
  photoUrls!: string[];

  /** Aligned 1:1 by index with photoUrls; null = no caption/room-label on that photo. */
  @Column({ type: 'simple-json', default: '[]' })
  photoCaptions!: (string | null)[];

  @Column({ type: 'varchar', nullable: true })
  agentName!: string | null;

  @Column({ type: 'varchar', nullable: true })
  agentPhone!: string | null;

  @Column({ type: 'varchar', nullable: true })
  agentEmail!: string | null;

  /** Original page URL — used to dedupe re-captures of the same listing. */
  @Index()
  @Column({ type: 'varchar', nullable: true })
  listingUrl!: string | null;

  /** False when the listing description tripped a Fair Housing / RESPA block rule. */
  @Column({ type: 'boolean', default: true })
  complianceOk!: boolean;

  /** ComplianceFlag[] from the guard (empty when clean). */
  @Column({ type: 'simple-json', default: '[]' })
  complianceFlags!: Array<{
    rule: string;
    severity: string;
    matched: string;
    detail: string;
  }>;

  @Index()
  @Column({ type: 'datetime' })
  capturedAt!: Date;
}
