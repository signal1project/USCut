import { describe, it, expect } from 'vitest';
import {
  computeBestTimes,
  nextOccurrence,
  slotLabel,
  DEFAULT_SLOTS,
} from '../bestTimes';
import { buildBioPageHtml } from '../bioPage';

describe('computeBestTimes', () => {
  it('ranks buckets by average engagement', () => {
    // Tue 10am strong, Wed 3pm weak
    const tue10 = new Date('2026-07-07T10:15:00'); // a Tuesday
    const wed15 = new Date('2026-07-08T15:30:00');
    const posts = [
      { publishedAt: tue10, engagements: 100 },
      { publishedAt: new Date('2026-06-30T10:45:00'), engagements: 80 }, // also Tue 10am
      { publishedAt: wed15, engagements: 5 },
    ];
    const slots = computeBestTimes(posts);
    expect(slots[0].dayOfWeek).toBe(2);
    expect(slots[0].hour).toBe(10);
    expect(slots[0].avgEngagements).toBe(90);
    expect(slots[0].sampleSize).toBe(2);
    expect(slots[1].hour).toBe(15);
  });

  it('returns empty for no posts', () => {
    expect(computeBestTimes([])).toEqual([]);
  });

  it('labels slots readably', () => {
    expect(
      slotLabel({ dayOfWeek: 2, hour: 10, avgEngagements: 0, sampleSize: 0 }),
    ).toBe('Tuesday 10:00 AM');
    expect(
      slotLabel({ dayOfWeek: 0, hour: 19, avgEngagements: 0, sampleSize: 0 }),
    ).toBe('Sunday 7:00 PM');
    expect(
      slotLabel({ dayOfWeek: 6, hour: 0, avgEngagements: 0, sampleSize: 0 }),
    ).toBe('Saturday 12:00 AM');
  });
});

describe('nextOccurrence', () => {
  it('finds the next future occurrence of a slot', () => {
    const from = new Date('2026-07-07T09:00:00'); // Tuesday 9am
    const slot = { dayOfWeek: 2, hour: 11, avgEngagements: 0, sampleSize: 0 };
    const next = nextOccurrence(slot, from);
    expect(next.getDay()).toBe(2);
    expect(next.getHours()).toBe(11);
    expect(next.getDate()).toBe(7); // same day, later hour
  });

  it('rolls to next week when the slot already passed', () => {
    const from = new Date('2026-07-07T12:00:00'); // Tuesday noon
    const slot = { dayOfWeek: 2, hour: 11, avgEngagements: 0, sampleSize: 0 };
    const next = nextOccurrence(slot, from);
    expect(next.getDay()).toBe(2);
    expect(next.getDate()).toBe(14);
  });

  it('has sane defaults', () => {
    expect(DEFAULT_SLOTS.length).toBeGreaterThanOrEqual(4);
  });
});

describe('buildBioPageHtml', () => {
  it('renders name, links, and listings with escaping', () => {
    const html = buildBioPageHtml({
      name: 'Dale <Brown>',
      tagline: 'Houston "Homes" & More',
      links: [{ label: 'Search Homes', url: 'https://example.com/search' }],
      listings: [
        {
          address: '123 Main St',
          price: '$425,000',
          url: 'https://example.com/l/1',
        },
      ],
    });
    expect(html).toContain('Dale &lt;Brown&gt;');
    expect(html).toContain('Houston &quot;Homes&quot; &amp; More');
    expect(html).toContain('href="https://example.com/search"');
    expect(html).toContain('123 Main St');
    expect(html).toContain('$425,000');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).not.toContain('<Brown>');
  });

  it('omits optional sections cleanly', () => {
    const html = buildBioPageHtml({ name: 'Solo', links: [] });
    expect(html).toContain('Solo');
    expect(html).not.toContain('Featured Listings');
  });
});
