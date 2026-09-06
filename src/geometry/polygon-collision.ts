import type { Point2D, Polygon } from './polygon';
import { getPolygonBounds, type PolygonBounds } from './polygon-transform';

const EPSILON = 1e-9;
const SAMPLE_EPSILON = 1e-5;
const USE_SEGMENT_AABB = true;

function crossProduct(a: Point2D, b: Point2D, c: Point2D): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

export function boundsOverlapWithArea(
  a: PolygonBounds,
  b: PolygonBounds,
): boolean {
  return (
    Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) > EPSILON &&
    Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY) > EPSILON
  );
}

function segmentBoundsMayIntersect(
  a1: Point2D,
  a2: Point2D,
  b1: Point2D,
  b2: Point2D,
): boolean {
  const aMinX = Math.min(a1.x, a2.x);
  const aMaxX = Math.max(a1.x, a2.x);
  const aMinY = Math.min(a1.y, a2.y);
  const aMaxY = Math.max(a1.y, a2.y);

  const bMinX = Math.min(b1.x, b2.x);
  const bMaxX = Math.max(b1.x, b2.x);
  const bMinY = Math.min(b1.y, b2.y);
  const bMaxY = Math.max(b1.y, b2.y);

  return (
    aMaxX >= bMinX - EPSILON &&
    bMaxX >= aMinX - EPSILON &&
    aMaxY >= bMinY - EPSILON &&
    bMaxY >= aMinY - EPSILON
  );
}

function segmentsProperlyIntersect(
  a1: Point2D,
  a2: Point2D,
  b1: Point2D,
  b2: Point2D,
): boolean {
  const c1 = crossProduct(a1, a2, b1);
  const c2 = crossProduct(a1, a2, b2);
  const c3 = crossProduct(b1, b2, a1);
  const c4 = crossProduct(b1, b2, a2);

  return c1 * c2 < -EPSILON && c3 * c4 < -EPSILON;
}

function pointIsStrictlyInsidePolygon(
  point: Point2D,
  polygon: Polygon,
): boolean {
  let inside = false;

  for (
    let currentIndex = 0, previousIndex = polygon.length - 1;
    currentIndex < polygon.length;
    previousIndex = currentIndex, currentIndex += 1
  ) {
    const current = polygon[currentIndex];
    const previous = polygon[previousIndex];

    if (!current || !previous) {
      continue;
    }

    const cross = crossProduct(previous, current, point);

    const minX = Math.min(previous.x, current.x);
    const maxX = Math.max(previous.x, current.x);
    const minY = Math.min(previous.y, current.y);
    const maxY = Math.max(previous.y, current.y);

    const liesOnSegment =
      Math.abs(cross) <= EPSILON &&
      point.x >= minX - EPSILON &&
      point.x <= maxX + EPSILON &&
      point.y >= minY - EPSILON &&
      point.y <= maxY + EPSILON;

    if (liesOnSegment) {
      return false;
    }

    const intersectsRay =
      current.y > point.y !== previous.y > point.y &&
      point.x <
        ((previous.x - current.x) * (point.y - current.y)) /
          (previous.y - current.y) +
          current.x;

    if (intersectsRay) {
      inside = !inside;
    }
  }

  return inside;
}

function getCollinearOverlapMidpoint(
  a1: Point2D,
  a2: Point2D,
  b1: Point2D,
  b2: Point2D,
): Point2D | null {
  if (
    Math.abs(crossProduct(a1, a2, b1)) > EPSILON ||
    Math.abs(crossProduct(a1, a2, b2)) > EPSILON
  ) {
    return null;
  }

  const dx = a2.x - a1.x;
  const dy = a2.y - a1.y;

  const useX = Math.abs(dx) >= Math.abs(dy);

  const aStart = useX ? a1.x : a1.y;
  const aEnd = useX ? a2.x : a2.y;
  const bStart = useX ? b1.x : b1.y;
  const bEnd = useX ? b2.x : b2.y;

  const overlapStart = Math.max(Math.min(aStart, aEnd), Math.min(bStart, bEnd));

  const overlapEnd = Math.min(Math.max(aStart, aEnd), Math.max(bStart, bEnd));

  if (overlapEnd - overlapStart <= EPSILON) {
    return null;
  }

  const overlapValue = (overlapStart + overlapEnd) / 2;

  if (useX) {
    if (Math.abs(dx) <= EPSILON) {
      return null;
    }

    const t = (overlapValue - a1.x) / dx;

    return {
      x: overlapValue,
      y: a1.y + t * dy,
    };
  }

  if (Math.abs(dy) <= EPSILON) {
    return null;
  }

  const t = (overlapValue - a1.y) / dy;

  return {
    x: a1.x + t * dx,
    y: overlapValue,
  };
}

function collinearEdgesCreateAreaOverlap(
  a1: Point2D,
  a2: Point2D,
  b1: Point2D,
  b2: Point2D,
  first: Polygon,
  second: Polygon,
): boolean {
  const midpoint = getCollinearOverlapMidpoint(a1, a2, b1, b2);

  if (!midpoint) {
    return false;
  }

  const dx = a2.x - a1.x;
  const dy = a2.y - a1.y;
  const length = Math.hypot(dx, dy);

  if (length <= EPSILON) {
    return false;
  }

  const normalX = -dy / length;
  const normalY = dx / length;

  const sampleA: Point2D = {
    x: midpoint.x + normalX * SAMPLE_EPSILON,
    y: midpoint.y + normalY * SAMPLE_EPSILON,
  };

  const sampleB: Point2D = {
    x: midpoint.x - normalX * SAMPLE_EPSILON,
    y: midpoint.y - normalY * SAMPLE_EPSILON,
  };

  const sampleAInsideBoth =
    pointIsStrictlyInsidePolygon(sampleA, first) &&
    pointIsStrictlyInsidePolygon(sampleA, second);

  const sampleBInsideBoth =
    pointIsStrictlyInsidePolygon(sampleB, first) &&
    pointIsStrictlyInsidePolygon(sampleB, second);

  return sampleAInsideBoth || sampleBInsideBoth;
}

function polygonsHaveAreaIntersection(
  first: Polygon,
  second: Polygon,
): boolean {
  for (let firstIndex = 0; firstIndex < first.length; firstIndex += 1) {
    const firstStart = first[firstIndex];
    const firstEnd = first[(firstIndex + 1) % first.length];

    if (!firstStart || !firstEnd) {
      continue;
    }

    for (let secondIndex = 0; secondIndex < second.length; secondIndex += 1) {
      const secondStart = second[secondIndex];
      const secondEnd = second[(secondIndex + 1) % second.length];

      if (!secondStart || !secondEnd) {
        continue;
      }

if (
  USE_SEGMENT_AABB &&
  !segmentBoundsMayIntersect(firstStart, firstEnd, secondStart, secondEnd)
) {
  continue;
}

      if (
        segmentsProperlyIntersect(firstStart, firstEnd, secondStart, secondEnd)
      ) {
        return true;
      }

      if (
        collinearEdgesCreateAreaOverlap(
          firstStart,
          firstEnd,
          secondStart,
          secondEnd,
          first,
          second,
        )
      ) {
        return true;
      }
    }
  }

  return false;
}

export function polygonsOverlap(
  first: Polygon,
  second: Polygon,
  firstBounds?: PolygonBounds,
  secondBounds?: PolygonBounds,
): boolean {
  if (first.length < 3 || second.length < 3) {
    return false;
  }

  /*
   * Si los bounding boxes no comparten área positiva,
   * las piezas como máximo se están tocando.
   */
  if (
    !boundsOverlapWithArea(
      firstBounds ?? getPolygonBounds(first),
      secondBounds ?? getPolygonBounds(second),
    )
  ) {
    return false;
  }

if (polygonsHaveAreaIntersection(first, second)) {
    return true;
  }

  /*
   * Detecta también cuando una forma está completamente
   * contenida dentro de la otra.
   */
  for (const point of first) {
    if (pointIsStrictlyInsidePolygon(point, second)) {
      return true;
    }
  }

  for (const point of second) {
    if (pointIsStrictlyInsidePolygon(point, first)) {
      return true;
    }
  }

  return false;
}
