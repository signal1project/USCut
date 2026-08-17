import type { TrackPoint } from './subjectTracker';

/**
 * Piecewise-linear ffmpeg expression for the tracked horizontal subject
 * center (0-1, normalized) as a function of `t` (ffmpeg's per-frame
 * timestamp in seconds). Flat before the first point and after the last.
 * Exported for tests.
 */
export function buildCxExpression(points: TrackPoint[]): string {
  if (points.length === 0) return '0.5'; // dead-center fallback, shouldn't happen
  if (points.length === 1) return points[0].cx.toFixed(4);

  const sorted = [...points].sort((a, b) => a.t - b.t);

  // Build from the last segment inward so each `if` nests the remaining
  // cases in its else-branch: if(t<t1, lerp(p0,p1), if(t<t2, lerp(p1,p2), ...)).
  let expr = sorted[sorted.length - 1].cx.toFixed(4);
  for (let i = sorted.length - 2; i >= 0; i--) {
    const p0 = sorted[i];
    const p1 = sorted[i + 1];
    const dt = p1.t - p0.t;
    const lerp =
      dt > 0
        ? `(${p0.cx.toFixed(4)}+(${(p1.cx - p0.cx).toFixed(4)})*(t-${p0.t.toFixed(4)})/${dt.toFixed(4)})`
        : p0.cx.toFixed(4);
    expr = `if(lt(t,${p1.t.toFixed(4)}),${lerp},${expr})`;
  }
  // Before the first point, hold at its value.
  expr = `if(lt(t,${sorted[0].t.toFixed(4)}),${sorted[0].cx.toFixed(4)},${expr})`;
  return expr;
}

/**
 * Vertical (9:16) crop that pans horizontally to follow a tracked subject,
 * replacing the fixed `crop='min(iw,1080)':1920:(iw-min(iw,1080))/2:0`
 * center-crop. Only x needs to track — height already matches the 1920
 * target after the preceding `scale=-2:1920`, so y stays 0. Must follow a
 * `scale=-2:1920` filter in the chain, same as the fixed-crop path.
 */
export function buildTrackedCropFilter(points: TrackPoint[]): string {
  const cxExpr = buildCxExpression(points);
  return `crop='min(iw,1080)':1920:'clip(${cxExpr}*iw-out_w/2,0,iw-out_w)':0`;
}
