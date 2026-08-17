import { describe, it, expect } from 'vitest';
import { buildCxExpression, buildTrackedCropFilter } from '../trackedCrop';
import type { TrackPoint } from '../subjectTracker';

describe('buildCxExpression', () => {
  it('returns a constant for a single point', () => {
    expect(buildCxExpression([{ t: 0, cx: 0.5, cy: 0.5 }])).toBe('0.5000');
  });

  it('returns the dead-center fallback for zero points', () => {
    expect(buildCxExpression([])).toBe('0.5');
  });

  it('builds a piecewise expression that references t for multiple points', () => {
    const points: TrackPoint[] = [
      { t: 0, cx: 0.2, cy: 0.5 },
      { t: 1, cx: 0.8, cy: 0.5 },
    ];
    const expr = buildCxExpression(points);
    expect(expr).toContain('lt(t,');
    expect(expr).toContain('0.2000');
    expect(expr).toContain('0.8000');
  });

  it('sorts unsorted input points by t before building the expression', () => {
    const points: TrackPoint[] = [
      { t: 2, cx: 0.9, cy: 0.5 },
      { t: 0, cx: 0.1, cy: 0.5 },
    ];
    const expr = buildCxExpression(points);
    // The earliest point's condition (t<2, the second point's t) should
    // appear, meaning ordering was normalized rather than taken as-given.
    expect(expr).toContain('lt(t,2.0000)');
  });
});

describe('buildTrackedCropFilter', () => {
  it('produces a crop filter that keeps the fixed 1080x1920 dims and pans x', () => {
    const points: TrackPoint[] = [
      { t: 0, cx: 0.3, cy: 0.5 },
      { t: 1, cx: 0.7, cy: 0.5 },
    ];
    const filter = buildTrackedCropFilter(points);
    expect(filter).toContain("crop='min(iw,1080)':1920:");
    // y stays fixed at 0 — only x tracks the subject.
    expect(filter.endsWith(':0')).toBe(true);
    expect(filter).toContain('clip(');
    expect(filter).toContain('out_w');
  });
});
