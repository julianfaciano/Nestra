import type { Point2D, Polygon } from './polygon';
import { getPolygonBounds } from './polygon-transform';
import { pointIsStrictlyInsidePolygon } from './polygon-collision';

function pointSegmentSquared(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const denominator = dx * dx + dy * dy;
  const t = denominator
    ? Math.max(
        0,
        Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / denominator),
      )
    : 0;
  return (p.x - a.x - t * dx) ** 2 + (p.y - a.y - t * dy) ** 2;
}
function cross(a: Point2D, b: Point2D, p: Point2D): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}
function segmentDistanceSquared(
  a: Point2D,
  b: Point2D,
  c: Point2D,
  d: Point2D,
): number {
  if (
    cross(a, b, c) * cross(a, b, d) < 0 &&
    cross(c, d, a) * cross(c, d, b) < 0
  )
    return 0;
  return Math.min(
    pointSegmentSquared(a, c, d),
    pointSegmentSquared(b, c, d),
    pointSegmentSquared(c, a, b),
    pointSegmentSquared(d, a, b),
  );
}
/** Euclidean distance between filled exterior contours. Overlap/containment => zero.
 * Isolated islands stay independent; bounds are only a lower-bound rejection.
 */
export function minimumContourDistance(
  a: readonly Polygon[],
  b: readonly Polygon[],
  stopBelow = 0,
): number {
  let best = stopBelow > 0 ? stopBelow : Infinity;
  for (const p of a)
    for (const q of b) {
      const pb = getPolygonBounds(p),
        qb = getPolygonBounds(q);
      const lower = Math.hypot(
        Math.max(0, pb.minX - qb.maxX, qb.minX - pb.maxX),
        Math.max(0, pb.minY - qb.maxY, qb.minY - pb.maxY),
      );
      if (lower >= best) continue;
      for (let i = 0; i < p.length; i++)
        for (let j = 0; j < q.length; j++) {
          const x = p[i]!,
            y = p[(i + 1) % p.length]!,
            u = q[j]!,
            v = q[(j + 1) % q.length]!;
          const dx = Math.max(
            0,
            Math.min(x.x, y.x) - Math.max(u.x, v.x),
            Math.min(u.x, v.x) - Math.max(x.x, y.x),
          );
          const dy = Math.max(
            0,
            Math.min(x.y, y.y) - Math.max(u.y, v.y),
            Math.min(u.y, v.y) - Math.max(x.y, y.y),
          );
          if (dx * dx + dy * dy >= best * best) continue;
          best = Math.min(best, Math.sqrt(segmentDistanceSquared(x, y, u, v)));
          if (best === 0 || best < stopBelow) return best;
        }
      // Segment crossings already produce zero. With disjoint boundaries, one
      // interior vertex suffices to detect a fully contained filled contour.
      if (
        p[0] &&
        q[0] &&
        (pointIsStrictlyInsidePolygon(p[0], q) ||
          pointIsStrictlyInsidePolygon(q[0], p))
      )
        return 0;
    }
  return best;
}
export function contoursViolateClearance(
  a: readonly Polygon[],
  b: readonly Polygon[],
  clearance: number,
): boolean {
  // Numerical tolerance only: 2.999 fails, exact 3.000 passes.
  return minimumContourDistance(a, b, clearance - 1e-9) < clearance - 1e-9;
}
