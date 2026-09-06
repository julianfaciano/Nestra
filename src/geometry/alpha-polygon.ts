import type { ImageDataLike } from './alpha-contour';
import type { Point2D, Polygon } from './polygon';

interface Edge {
  readonly start: Point2D;
  readonly end: Point2D;
}

export interface AlphaPolygonResult {
  readonly rawPointCount: number;
  readonly simplifiedPointCount: number;
  readonly rawPolygon: Polygon;
  readonly simplifiedPolygon: Polygon;
  readonly outerLoopCount: number;
}

function pointKey(point: Point2D): string {
  return `${point.x},${point.y}`;
}

function pointsEqual(a: Point2D, b: Point2D): boolean {
  return a.x === b.x && a.y === b.y;
}

function perpendicularDistance(
  point: Point2D,
  lineStart: Point2D,
  lineEnd: Point2D,
): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;

  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - lineStart.x, point.y - lineStart.y);
  }

  const numerator = Math.abs(
    dy * point.x -
      dx * point.y +
      lineEnd.x * lineStart.y -
      lineEnd.y * lineStart.x,
  );

  return numerator / Math.hypot(dx, dy);
}

function simplifyOpenPolyline(
  points: readonly Point2D[],
  tolerance: number,
): Point2D[] {
  if (points.length <= 2) {
    return [...points];
  }

  const first = points[0];
  const last = points[points.length - 1];

  if (!first || !last) {
    return [...points];
  }

  let maxDistance = 0;
  let splitIndex = 0;

  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];

    if (!point) {
      continue;
    }

    const distance = perpendicularDistance(point, first, last);

    if (distance > maxDistance) {
      maxDistance = distance;
      splitIndex = index;
    }
  }

  if (maxDistance <= tolerance) {
    return [first, last];
  }

  const left = simplifyOpenPolyline(points.slice(0, splitIndex + 1), tolerance);

  const right = simplifyOpenPolyline(points.slice(splitIndex), tolerance);

  return [...left.slice(0, -1), ...right];
}

function squaredDistance(a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;

  return dx * dx + dy * dy;
}

function simplifyClosedPolygon(
  polygon: readonly Point2D[],
  tolerance: number,
): Point2D[] {
  if (polygon.length <= 3 || tolerance <= 0) {
    return [...polygon];
  }

  const first = polygon[0];

  if (!first) {
    return [...polygon];
  }

  let firstSplitIndex = 0;
  let firstMaxDistance = -1;

  for (let index = 1; index < polygon.length; index += 1) {
    const point = polygon[index];

    if (!point) {
      continue;
    }

    const distance = squaredDistance(first, point);

    if (distance > firstMaxDistance) {
      firstMaxDistance = distance;
      firstSplitIndex = index;
    }
  }

  const splitPoint = polygon[firstSplitIndex];

  if (!splitPoint) {
    return [...polygon];
  }

  let secondSplitIndex = firstSplitIndex;
  let secondMaxDistance = -1;

  for (let index = 0; index < polygon.length; index += 1) {
    const point = polygon[index];

    if (!point) {
      continue;
    }

    const distance = squaredDistance(splitPoint, point);

    if (distance > secondMaxDistance) {
      secondMaxDistance = distance;
      secondSplitIndex = index;
    }
  }

  const startIndex = Math.min(firstSplitIndex, secondSplitIndex);
  const endIndex = Math.max(firstSplitIndex, secondSplitIndex);

  const firstArc = polygon.slice(startIndex, endIndex + 1);
  const secondArc = [
    ...polygon.slice(endIndex),
    ...polygon.slice(0, startIndex + 1),
  ];

  const simplifiedFirst = simplifyOpenPolyline(firstArc, tolerance);

  const simplifiedSecond = simplifyOpenPolyline(secondArc, tolerance);

  return [...simplifiedFirst.slice(0, -1), ...simplifiedSecond.slice(0, -1)];
}

function signedPolygonArea(polygon: readonly Point2D[]): number {
  if (polygon.length < 3) {
    return 0;
  }

  let area = 0;

  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];

    if (!current || !next) {
      continue;
    }

    area += current.x * next.y - next.x * current.y;
  }

  return area / 2;
}

function polygonArea(polygon: readonly Point2D[]): number {
  return Math.abs(signedPolygonArea(polygon));
}

function buildBoundaryEdges(
  imageData: ImageDataLike,
  alphaThreshold: number,
): Edge[] {
  const { width, height, data } = imageData;
  const occupied = new Uint8Array(width * height);

  function isOccupied(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return false;
    }

    return occupied[y * width + x] === 1;
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * 4 + 3] ?? 0;

      if (alpha > alphaThreshold) {
        occupied[y * width + x] = 1;
      }
    }
  }

  const edges: Edge[] = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!isOccupied(x, y)) {
        continue;
      }

      if (!isOccupied(x, y - 1)) {
        edges.push({
          start: { x, y },
          end: { x: x + 1, y },
        });
      }

      if (!isOccupied(x + 1, y)) {
        edges.push({
          start: { x: x + 1, y },
          end: { x: x + 1, y: y + 1 },
        });
      }

      if (!isOccupied(x, y + 1)) {
        edges.push({
          start: { x: x + 1, y: y + 1 },
          end: { x, y: y + 1 },
        });
      }

      if (!isOccupied(x - 1, y)) {
        edges.push({
          start: { x, y: y + 1 },
          end: { x, y },
        });
      }
    }
  }

  return edges;
}

function traceLoops(edges: readonly Edge[]): Point2D[][] {
  const outgoing = new Map<string, Edge[]>();

  for (const edge of edges) {
    const key = pointKey(edge.start);
    const current = outgoing.get(key) ?? [];

    current.push(edge);
    outgoing.set(key, current);
  }

  const unused = new Set(edges);
  const loops: Point2D[][] = [];

  while (unused.size > 0) {
    const firstEdge = unused.values().next().value as Edge | undefined;

    if (!firstEdge) {
      break;
    }

    const loop: Point2D[] = [firstEdge.start];
    let currentEdge: Edge | undefined = firstEdge;

    unused.delete(firstEdge);

    while (currentEdge) {
      const currentEnd: Point2D = currentEdge.end;

      if (pointsEqual(currentEnd, loop[0] ?? currentEnd)) {
        break;
      }

      loop.push(currentEnd);

      const candidates: Edge[] = outgoing.get(pointKey(currentEnd)) ?? [];

      const nextEdge: Edge | undefined = candidates.find((edge: Edge) =>
        unused.has(edge),
      );

      if (!nextEdge) {
        break;
      }

      unused.delete(nextEdge);
      currentEdge = nextEdge;
    }

    if (loop.length >= 3) {
      loops.push(loop);
    }
  }

  return loops;
}

export function extractLargestAlphaPolygon(
  imageData: ImageDataLike,
  alphaThreshold: number,
  simplificationTolerancePx: number,
): AlphaPolygonResult | null {
  const edges = buildBoundaryEdges(imageData, alphaThreshold);
  const loops = traceLoops(edges);

  if (loops.length === 0) {
    return null;
  }

  const largestLoop = loops.reduce((largest, candidate) =>
  polygonArea(candidate) > polygonArea(largest) ? candidate : largest,
);

const largestOrientation = Math.sign(signedPolygonArea(largestLoop));

const outerLoopCount = loops.filter((loop) => {
  const signedArea = signedPolygonArea(loop);

  return (
    Math.abs(signedArea) > 0 &&
    Math.sign(signedArea) === largestOrientation
  );
}).length;

const simplifiedPolygon = simplifyClosedPolygon(
    largestLoop,
    Math.max(0, simplificationTolerancePx),
  );

  return {
  rawPointCount: largestLoop.length,
  simplifiedPointCount: simplifiedPolygon.length,
  rawPolygon: largestLoop,
  simplifiedPolygon,
  outerLoopCount,
};
}
