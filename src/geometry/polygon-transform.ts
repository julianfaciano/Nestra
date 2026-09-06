import type { Point2D, Polygon } from './polygon';

export type PieceRotation = 0 | 90 | -90 | 180;

export interface PolygonPlacement {
  readonly x: number;
  readonly y: number;
  readonly rotation: PieceRotation;
}

export interface PolygonBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly width: number;
  readonly height: number;
}

export function polygonPixelsToMillimeters(
  polygon: Polygon,
  sourceWidthPx: number,
  sourceHeightPx: number,
  physicalWidthMm: number,
  physicalHeightMm: number,
): Polygon {
  if (sourceWidthPx <= 0 || sourceHeightPx <= 0) {
    throw new Error('Las dimensiones raster deben ser mayores que cero.');
  }

  if (physicalWidthMm <= 0 || physicalHeightMm <= 0) {
    throw new Error('Las dimensiones físicas deben ser mayores que cero.');
  }

  const scaleX = physicalWidthMm / sourceWidthPx;
  const scaleY = physicalHeightMm / sourceHeightPx;

  return polygon.map((point) => ({
    x: point.x * scaleX,
    y: point.y * scaleY,
  }));
}

export function rotatePoint(point: Point2D, rotation: PieceRotation): Point2D {
  switch (rotation) {
    case 0:
      return point;

    case 90:
      return {
        x: -point.y,
        y: point.x,
      };

    case -90:
      return {
        x: point.y,
        y: -point.x,
      };

    case 180:
      return {
        x: -point.x,
        y: -point.y,
      };
  }
}

export function getPolygonBounds(polygon: Polygon): PolygonBounds {
  if (polygon.length === 0) {
    throw new Error('El polígono no puede estar vacío.');
  }

  const first = polygon[0];

  if (!first) {
    throw new Error('El polígono no puede estar vacío.');
  }

  let minX = first.x;
  let minY = first.y;
  let maxX = first.x;
  let maxY = first.y;

  for (const point of polygon) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

export function normalizePolygonOrigin(polygon: Polygon): Polygon {
  const bounds = getPolygonBounds(polygon);

  return polygon.map((point) => ({
    x: point.x - bounds.minX,
    y: point.y - bounds.minY,
  }));
}

export function transformPolygon(
  polygon: Polygon,
  placement: PolygonPlacement,
): Polygon {
  const rotated = polygon.map((point) =>
    rotatePoint(point, placement.rotation),
  );

  const normalized = normalizePolygonOrigin(rotated);

  return normalized.map((point) => ({
    x: point.x + placement.x,
    y: point.y + placement.y,
  }));
}
