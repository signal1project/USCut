import { describe, it, expect } from 'vitest';
import {
  classifyPhotoCaption,
  assignPhotoBuckets,
  resolveMoneyShotLabel,
  REEL_BUCKET_PLAN,
} from '../roomBuckets';

describe('classifyPhotoCaption', () => {
  it('classifies kitchen captions', () => {
    expect(classifyPhotoCaption('Updated Kitchen')).toBe('kitchen');
  });

  it('classifies living-room-ish captions', () => {
    expect(classifyPhotoCaption('Open Concept Living Room')).toBe('living');
    expect(classifyPhotoCaption('Family Room')).toBe('living');
  });

  it('classifies bed/bath captions as primary_bath', () => {
    expect(classifyPhotoCaption('Primary Bedroom')).toBe('primary_bath');
    expect(classifyPhotoCaption('En-Suite Bathroom')).toBe('primary_bath');
  });

  it('classifies outdoor/feature captions as money_shot', () => {
    expect(classifyPhotoCaption('1.2 Acres')).toBe('money_shot');
    expect(classifyPhotoCaption('Backyard Deck')).toBe('money_shot');
    expect(classifyPhotoCaption('3-Car Garage')).toBe('money_shot');
  });

  it('classifies exterior captions as hook', () => {
    expect(classifyPhotoCaption('Front Exterior')).toBe('hook');
    expect(classifyPhotoCaption('Curb Appeal')).toBe('hook');
  });

  it('returns null for unrecognized or missing captions', () => {
    expect(classifyPhotoCaption('Hallway')).toBeNull();
    expect(classifyPhotoCaption(null)).toBeNull();
    expect(classifyPhotoCaption(undefined)).toBeNull();
    expect(classifyPhotoCaption('   ')).toBeNull();
  });
});

describe('assignPhotoBuckets', () => {
  it('assigns captioned photos to their matching bucket first', () => {
    const { assignments } = assignPhotoBuckets([
      { url: 'a', caption: 'Kitchen' },
      { url: 'b', caption: 'Living Room' },
      { url: 'c', caption: 'Primary Bedroom' },
      { url: 'd', caption: 'Backyard' },
      { url: 'e', caption: 'Front Exterior' },
    ]);
    expect(assignments.get('hook')!.map((p) => p.url)).toEqual(['e']);
    expect(assignments.get('kitchen')!.map((p) => p.url)).toEqual(['a']);
    expect(assignments.get('living')!.map((p) => p.url)).toEqual(['b']);
    expect(assignments.get('primary_bath')!.map((p) => p.url)).toEqual(['c']);
    expect(assignments.get('money_shot')!.map((p) => p.url)).toEqual(['d']);
  });

  it('fills every bucket to its minimum positionally when nothing is captioned', () => {
    const photos = Array.from({ length: 5 }, (_, i) => ({ url: `p${i}` }));
    const { assignments } = assignPhotoBuckets(photos);
    for (const spec of REEL_BUCKET_PLAN) {
      expect(assignments.get(spec.bucket)!.length).toBeGreaterThanOrEqual(1);
    }
    // hook claims the first photo when nothing is pre-classified.
    expect(assignments.get('hook')!.map((p) => p.url)).toEqual(['p0']);
  });

  it('degrades gracefully with fewer photos than buckets, never throwing', () => {
    expect(() =>
      assignPhotoBuckets([{ url: 'only-one' }]),
    ).not.toThrow();
    const { assignments } = assignPhotoBuckets([{ url: 'only-one' }]);
    expect(assignments.get('hook')!.map((p) => p.url)).toEqual(['only-one']);
    expect(assignments.get('kitchen')).toEqual([]);
  });

  it('handles zero photos without throwing, every bucket empty', () => {
    expect(() => assignPhotoBuckets([])).not.toThrow();
    const { assignments } = assignPhotoBuckets([]);
    for (const spec of REEL_BUCKET_PLAN) {
      expect(assignments.get(spec.bucket)).toEqual([]);
    }
  });

  it('mixes captioned and uncaptioned photos correctly', () => {
    const { assignments } = assignPhotoBuckets([
      { url: 'a', caption: 'Kitchen' },
      { url: 'b' },
      { url: 'c' },
    ]);
    expect(assignments.get('kitchen')!.map((p) => p.url)).toEqual(['a']);
    // 'b' becomes hook (first remaining), 'c' fills the next unfilled bucket minimum.
    expect(assignments.get('hook')!.map((p) => p.url)).toEqual(['b']);
    expect(assignments.get('living')!.map((p) => p.url)).toEqual(['c']);
  });

  it('tops up buckets toward their max with abundant leftover photos, after every bucket has its minimum', () => {
    const photos = Array.from({ length: 8 }, (_, i) => ({ url: `p${i}` }));
    const { assignments } = assignPhotoBuckets(photos);
    expect(assignments.get('hook')!.length).toBe(1); // hook maxPhotos is 1
    expect(assignments.get('kitchen')!.length).toBe(2);
    expect(assignments.get('living')!.length).toBe(2);
    expect(assignments.get('primary_bath')!.length).toBe(2);
    expect(assignments.get('money_shot')!.length).toBe(1); // money_shot maxPhotos is 1
    const totalUsed = [...assignments.values()].reduce(
      (n, list) => n + list.length,
      0,
    );
    expect(totalUsed).toBe(8); // nothing dropped
  });

  it('respects photoOrder, dropping out-of-range indexes', () => {
    const photos = [
      { url: 'a', caption: 'Kitchen' },
      { url: 'b', caption: 'Backyard' },
      { url: 'c', caption: 'Front Exterior' },
    ];
    const { assignments } = assignPhotoBuckets(photos, {
      photoOrder: [2, 99, 0],
    });
    expect(assignments.get('hook')!.map((p) => p.url)).toEqual(['c']);
    expect(assignments.get('kitchen')!.map((p) => p.url)).toEqual(['a']);
  });
});

describe('resolveMoneyShotLabel', () => {
  it("uses the assigned photo's own caption when present", () => {
    const assignment = assignPhotoBuckets([{ url: 'a', caption: '1.2 Acres' }]);
    expect(resolveMoneyShotLabel(assignment)).toBe('1.2 Acres');
  });

  it('falls back to a generic label when no caption is available', () => {
    const assignment = assignPhotoBuckets([{ url: 'a' }, { url: 'b' }]);
    expect(resolveMoneyShotLabel(assignment)).toBe('Outdoor Living');
  });
});
