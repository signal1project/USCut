import { describe, it, expect } from 'vitest';
import { selectPriceTier, LUXURY_THRESHOLD_CENTS } from '../priceTier';

describe('selectPriceTier', () => {
  it('is standard just under the threshold', () => {
    expect(selectPriceTier(LUXURY_THRESHOLD_CENTS - 1)).toBe('standard');
  });

  it('is luxury exactly at the threshold', () => {
    expect(selectPriceTier(LUXURY_THRESHOLD_CENTS)).toBe('luxury');
  });

  it('is luxury above the threshold', () => {
    expect(selectPriceTier(125_000_000)).toBe('luxury');
  });

  it('treats null/undefined price as standard', () => {
    expect(selectPriceTier(null)).toBe('standard');
    expect(selectPriceTier(undefined)).toBe('standard');
  });
});
