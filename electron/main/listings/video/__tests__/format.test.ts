import { describe, it, expect } from 'vitest';
import { formatPrice, formatSpecsShort } from '../format';

describe('formatPrice', () => {
  it('formats sub-$1M prices with commas', () => {
    expect(formatPrice(42_500_000)).toBe('$425,000');
  });

  it('formats $1M+ prices as an abbreviated M value', () => {
    expect(formatPrice(125_000_000)).toBe('$1.25M');
  });

  it('returns empty string for null/undefined/zero', () => {
    expect(formatPrice(null)).toBe('');
    expect(formatPrice(undefined)).toBe('');
    expect(formatPrice(0)).toBe('');
  });
});

describe('formatSpecsShort', () => {
  it('joins present specs with a middle dot', () => {
    expect(formatSpecsShort({ beds: 3, baths: 2, sqft: 1850 })).toBe(
      '3 bd · 2 ba · 1,850 sqft',
    );
  });

  it('omits missing specs cleanly', () => {
    expect(formatSpecsShort({ beds: 3, baths: null, sqft: null })).toBe(
      '3 bd',
    );
    expect(formatSpecsShort({ beds: null, baths: null, sqft: null })).toBe(
      '',
    );
  });
});
