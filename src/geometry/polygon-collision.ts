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
  edges?: readonly number[],
): boolean {
  let inside = false;

  for (
    let currentIndex = 0, previousIndex = polygon.length - 1;
    currentIndex < (edges?.length ?? polygon.length);
    previousIndex = currentIndex, currentIndex += 1
  ) {
    const edge = edges?.[currentIndex];
    const current = polygon[edge === undefined ? currentIndex : (edge + 1) % polygon.length];
    const previous = polygon[edge === undefined ? previousIndex : edge];

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
  candidates?: (a: Point2D, b: Point2D) => readonly number[],
  indexedBounds?: PolygonBounds,
): boolean {
  for (let firstIndex = 0; firstIndex < first.length; firstIndex += 1) {
    const firstStart = first[firstIndex];
    const firstEnd = first[(firstIndex + 1) % first.length];

    if (!firstStart || !firstEnd) {
      continue;
    }

    // Filler-only indexed path: avoid allocating/querying an empty candidate
    // list when this edge cannot meet any edge of the other polygon.
    if (indexedBounds && (
      Math.max(firstStart.x,firstEnd.x) < indexedBounds.minX-EPSILON ||
      Math.min(firstStart.x,firstEnd.x) > indexedBounds.maxX+EPSILON ||
      Math.max(firstStart.y,firstEnd.y) < indexedBounds.minY-EPSILON ||
      Math.min(firstStart.y,firstEnd.y) > indexedBounds.maxY+EPSILON)) continue;

    const indices = candidates?.(firstStart, firstEnd);
    for (let offset = 0; offset < (indices?.length ?? second.length); offset += 1) {
      const secondIndex = indices ? indices[offset]! : offset;
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
  candidates?: (a: Point2D, b: Point2D) => readonly number[],
  contains = pointIsStrictlyInsidePolygon,
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

if (polygonsHaveAreaIntersection(first, second, candidates, candidates ? secondBounds : undefined)) {
    return true;
  }

  /*
   * Detecta también cuando una forma está completamente
   * contenida dentro de la otra.
   */
  for (const point of first) {
    if (candidates && secondBounds && (point.x < secondBounds.minX-EPSILON || point.x > secondBounds.maxX+EPSILON ||
      point.y < secondBounds.minY-EPSILON || point.y > secondBounds.maxY+EPSILON)) continue;
    if (contains(point, second)) {
      return true;
    }
  }

  for (const point of second) {
    if (candidates && firstBounds && (point.x < firstBounds.minX-EPSILON || point.x > firstBounds.maxX+EPSILON ||
      point.y < firstBounds.minY-EPSILON || point.y > firstBounds.maxY+EPSILON)) continue;
    if (contains(point, first)) {
      return true;
    }
  }

  return false;
}

/** Per filler phase: index immutable placed contours; keep all exact predicates. */
export function createPolygonSegmentQuery() {
  interface Node {
    minX: number; maxX: number; minY: number; maxY: number;
    indices?: number[]; left?: Node; right?: Node;
  }
  const cache = new WeakMap<Polygon, Node>();
  const build = (polygon: Polygon): Node => {
    const edges = polygon.map((a,i) => {
      const b = polygon[(i+1)%polygon.length]!;
      return {i,minX:Math.min(a.x,b.x),maxX:Math.max(a.x,b.x),minY:Math.min(a.y,b.y),maxY:Math.max(a.y,b.y)};
    });
    const branch = (items: typeof edges): Node => {
      const node: Node = {minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity};
      for (const e of items) {
        node.minX=Math.min(node.minX,e.minX); node.maxX=Math.max(node.maxX,e.maxX);
        node.minY=Math.min(node.minY,e.minY); node.maxY=Math.max(node.maxY,e.maxY);
      }
      if(items.length <= 8) node.indices=items.map(e=>e.i);
      else {
        const x = node.maxX-node.minX >= node.maxY-node.minY;
        items.sort((a,b)=>x ? (a.minX+a.maxX)-(b.minX+b.maxX) : (a.minY+a.maxY)-(b.minY+b.maxY));
        const middle=Math.floor(items.length/2);
        node.left=branch(items.slice(0,middle)); node.right=branch(items.slice(middle));
      }
      return node;
    };
    return branch(edges);
  };
  return (second: Polygon, a: Point2D, b: Point2D): readonly number[] => {
    let root=cache.get(second);
    if(!root) {root=build(second);cache.set(second,root);}
      const minX=Math.min(a.x,b.x),maxX=Math.max(a.x,b.x),minY=Math.min(a.y,b.y),maxY=Math.max(a.y,b.y);
      const indices:number[]=[];
      const visit=(node:Node):void=>{
        if(maxX < node.minX-EPSILON || node.maxX < minX-EPSILON || maxY < node.minY-EPSILON || node.maxY < minY-EPSILON) return;
        if(node.indices) indices.push(...node.indices);
        else {visit(node.left!);visit(node.right!);}
      };
      visit(root!);
      // Preserve the reference's exact evaluation order for surviving segments.
      return indices.sort((a,b)=>a-b);
  };
}

export function createIndexedPolygonOverlap(segments = createPolygonSegmentQuery()): typeof polygonsOverlap {
  const boundsCache = new WeakMap<Polygon, PolygonBounds>();
  const contains = (point: Point2D, polygon: Polygon, indexed: boolean): boolean => {
    if (polygon.length <= 8) return pointIsStrictlyInsidePolygon(point, polygon);
    if (indexed) {
      const bounds = boundsCache.get(polygon)!;
      return pointIsStrictlyInsidePolygon(point, polygon, segments(polygon,
        {x:bounds.minX,y:point.y}, {x:bounds.maxX,y:point.y}));
    }
    // Retain every ray crossing and possible boundary hit, including EPSILON.
    // A linear y filter avoids building an index for transient candidate polygons.
    const edges: number[] = [];
    for (let i=0;i<polygon.length;i++) {
      const a=polygon[i]!, b=polygon[(i+1)%polygon.length]!;
      if (point.y >= Math.min(a.y,b.y)-EPSILON && point.y <= Math.max(a.y,b.y)+EPSILON) edges.push(i);
    }
    return pointIsStrictlyInsidePolygon(point, polygon, edges);
  };
  return (first, second, firstBounds, secondBounds) => {
    if(first.length < 3 || second.length < 3) return false;
    firstBounds ??= getPolygonBounds(first);
    secondBounds ??= boundsCache.get(second) ?? getPolygonBounds(second);
    boundsCache.set(second,secondBounds);
    if(!boundsOverlapWithArea(firstBounds,secondBounds)) return false;
    return polygonsOverlap(first,second,firstBounds,secondBounds,(a,b)=>segments(second,a,b),
      (point,polygon)=>contains(point,polygon,polygon===second));
  };
}
