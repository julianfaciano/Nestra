import type { Point2D, Polygon } from './polygon';
import { getPolygonBounds, type PolygonBounds } from './polygon-transform';
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

interface ClearanceSegment {
  readonly index: number;
  readonly a: Point2D;
  readonly b: Point2D;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly contourIndex: number;
}

export interface PreparedClearanceContours {
  readonly contours: readonly Polygon[];
  readonly bounds: readonly PolygonBounds[];
  readonly segments: readonly ClearanceSegment[];
  readonly segmentsByContour: readonly (readonly ClearanceSegment[])[];
}

export interface ClearanceContourIndex extends PreparedClearanceContours {
  readonly buckets: ReadonlyMap<string, readonly ClearanceSegment[]>;
  readonly oversizedSegments: readonly ClearanceSegment[];
  readonly lastSeen: Int32Array;
  queryToken: number;
}

export interface ClearanceQueryCounters {
  clearanceIndexedCalls: number;
  clearanceSegmentCandidates: number;
  clearanceSegmentAabbChecks: number;
  clearanceSegmentExactChecks: number;
}

const CLEARANCE_INDEX_CELL_MM = 50;
const MAX_SEGMENT_CELLS = 64;

export function prepareClearanceContours(
  contours: readonly Polygon[],
): PreparedClearanceContours {
  const bounds: PolygonBounds[] = [];
  const segments: ClearanceSegment[] = [];
  const segmentsByContour: ClearanceSegment[][] = [];
  contours.forEach((contour, contourIndex) => {
    bounds.push(getPolygonBounds(contour));
    const contourSegments: ClearanceSegment[] = [];
    for (let index = 0; index < contour.length; index++) {
      const a = contour[index]!;
      const b = contour[(index + 1) % contour.length]!;
      const segment = {
        index: segments.length,
        a,
        b,
        minX: Math.min(a.x, b.x),
        minY: Math.min(a.y, b.y),
        maxX: Math.max(a.x, b.x),
        maxY: Math.max(a.y, b.y),
        contourIndex,
      };
      segments.push(segment);
      contourSegments.push(segment);
    }
    segmentsByContour.push(contourSegments);
  });
  return { contours, bounds, segments, segmentsByContour };
}

export function indexClearanceContours(
  prepared: PreparedClearanceContours,
): ClearanceContourIndex {
  const buckets = new Map<string, ClearanceSegment[]>();
  const oversizedSegments: ClearanceSegment[] = [];
  for (const segment of prepared.segments) {
    const minCellX = Math.floor(segment.minX / CLEARANCE_INDEX_CELL_MM);
    const maxCellX = Math.floor(segment.maxX / CLEARANCE_INDEX_CELL_MM);
    const minCellY = Math.floor(segment.minY / CLEARANCE_INDEX_CELL_MM);
    const maxCellY = Math.floor(segment.maxY / CLEARANCE_INDEX_CELL_MM);
    const cells = (maxCellX - minCellX + 1) * (maxCellY - minCellY + 1);
    if (cells > MAX_SEGMENT_CELLS) {
      oversizedSegments.push(segment);
      continue;
    }
    for (let cellY = minCellY; cellY <= maxCellY; cellY++) {
      for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
        const key = `${cellX},${cellY}`;
        const bucket = buckets.get(key) ?? [];
        bucket.push(segment);
        buckets.set(key, bucket);
      }
    }
  }
  return {
    ...prepared,
    buckets,
    oversizedSegments,
    lastSeen: new Int32Array(prepared.segments.length),
    queryToken: 0,
  };
}

function segmentAabbDistanceSquared(
  minAX: number,
  minAY: number,
  maxAX: number,
  maxAY: number,
  b: ClearanceSegment,
): number {
  const dx = Math.max(0, minAX - b.maxX, b.minX - maxAX);
  const dy = Math.max(0, minAY - b.maxY, b.minY - maxAY);
  return dx * dx + dy * dy;
}

/** Exact clearance test accelerated only by a lossless segment-AABB grid. */
export function indexedContoursViolateClearance(
  moving: PreparedClearanceContours,
  offsetX: number,
  offsetY: number,
  fixed: ClearanceContourIndex,
  clearance: number,
  counters?: ClearanceQueryCounters,
): boolean {
  if (counters) counters.clearanceIndexedCalls++;
  const threshold = clearance - 1e-9;
  if (threshold <= 0) return false;
  const thresholdSquared = threshold * threshold;
  const fixedContourBounds = fixed.bounds;
  const tokenFor = () => {
    fixed.queryToken = fixed.queryToken >= 2_000_000_000 ? 1 : fixed.queryToken + 1;
    return fixed.queryToken;
  };

  for (let movingContourIndex = 0; movingContourIndex < moving.contours.length; movingContourIndex++) {
    const movingContour = moving.contours[movingContourIndex]!;
    const movingBounds = moving.bounds[movingContourIndex]!;
    const movedBounds = {
      minX: movingBounds.minX + offsetX,
      minY: movingBounds.minY + offsetY,
      maxX: movingBounds.maxX + offsetX,
      maxY: movingBounds.maxY + offsetY,
    };
    for (let fixedContourIndex = 0; fixedContourIndex < fixed.contours.length; fixedContourIndex++) {
      const fixedBounds = fixedContourBounds[fixedContourIndex]!;
      const contourDx = Math.max(0, movedBounds.minX - fixedBounds.maxX, fixedBounds.minX - movedBounds.maxX);
      const contourDy = Math.max(0, movedBounds.minY - fixedBounds.maxY, fixedBounds.minY - movedBounds.maxY);
      if (contourDx * contourDx + contourDy * contourDy >= thresholdSquared) continue;

      const movingPoint = movingContour[0]!;
      const fixedPoint = fixed.contours[fixedContourIndex]![0]!;
      if (pointIsStrictlyInsidePolygon(
        { x: movingPoint.x + offsetX, y: movingPoint.y + offsetY },
        fixed.contours[fixedContourIndex]!,
      ) || pointIsStrictlyInsidePolygon(
        { x: fixedPoint.x - offsetX, y: fixedPoint.y - offsetY },
        movingContour,
      )) return true;

      for (const movingSegment of moving.segmentsByContour[movingContourIndex]!) {
        const minX = movingSegment.minX + offsetX;
        const minY = movingSegment.minY + offsetY;
        const maxX = movingSegment.maxX + offsetX;
        const maxY = movingSegment.maxY + offsetY;
        const queryMinX = Math.floor((minX - threshold) / CLEARANCE_INDEX_CELL_MM);
        const queryMaxX = Math.floor((maxX + threshold) / CLEARANCE_INDEX_CELL_MM);
        const queryMinY = Math.floor((minY - threshold) / CLEARANCE_INDEX_CELL_MM);
        const queryMaxY = Math.floor((maxY + threshold) / CLEARANCE_INDEX_CELL_MM);
        const queryCells = (queryMaxX - queryMinX + 1) * (queryMaxY - queryMinY + 1);
        const token = tokenFor();
        const visit = (fixedSegment: ClearanceSegment) => {
          const segmentIndex = fixedSegment.index;
          if (segmentIndex < 0 || fixed.lastSeen[segmentIndex] === token || fixedSegment.contourIndex !== fixedContourIndex) return false;
          fixed.lastSeen[segmentIndex] = token;
          if (counters) {
            counters.clearanceSegmentCandidates++;
            counters.clearanceSegmentAabbChecks++;
          }
          if (segmentAabbDistanceSquared(minX, minY, maxX, maxY, fixedSegment) >= thresholdSquared) return false;
          if (counters) counters.clearanceSegmentExactChecks++;
          const a = { x: movingSegment.a.x + offsetX, y: movingSegment.a.y + offsetY };
          const b = { x: movingSegment.b.x + offsetX, y: movingSegment.b.y + offsetY };
          return segmentDistanceSquared(a, b, fixedSegment.a, fixedSegment.b) < thresholdSquared;
        };
        if (queryCells > MAX_SEGMENT_CELLS * 4) {
          for (const fixedSegment of fixed.segments) if (visit(fixedSegment)) return true;
        } else {
          for (let cellY = queryMinY; cellY <= queryMaxY; cellY++) {
            for (let cellX = queryMinX; cellX <= queryMaxX; cellX++) {
              for (const fixedSegment of fixed.buckets.get(`${cellX},${cellY}`) ?? []) {
                if (visit(fixedSegment)) return true;
              }
            }
          }
          for (const fixedSegment of fixed.oversizedSegments) if (visit(fixedSegment)) return true;
        }
      }
    }
  }
  return false;
}
