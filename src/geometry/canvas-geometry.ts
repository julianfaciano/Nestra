import type { Polygon } from './polygon';
import { getPolygonBounds } from './polygon-transform';

const EPSILON = 1e-9;

export interface PhysicalCanvasSize {
  readonly width: number;
  readonly height: number;
}

export function polygonFitsInsideCanvas(
  polygon: Polygon,
  canvas: PhysicalCanvasSize,
): boolean {
  if (polygon.length === 0) {
    return false;
  }

  if (canvas.width <= 0 || canvas.height <= 0) {
    return false;
  }

  const bounds = getPolygonBounds(polygon);

  return (
    bounds.minX >= -EPSILON &&
    bounds.minY >= -EPSILON &&
    bounds.maxX <= canvas.width + EPSILON &&
    bounds.maxY <= canvas.height + EPSILON
  );
}
