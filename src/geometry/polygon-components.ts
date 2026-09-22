import type { Polygon } from './polygon';
import { getPolygonBounds, rotatePoint, type PolygonPlacement } from './polygon-transform';
import { polygonsOverlap } from './polygon-collision';

export function componentEnvelope(components: readonly Polygon[]): Polygon {
  const b = getPolygonBounds(components.flat());
  return [{x:b.minX,y:b.minY},{x:b.maxX,y:b.minY},{x:b.maxX,y:b.maxY},{x:b.minX,y:b.maxY}];
}

/** Normalize once for the entire PNG; never move islands independently. */
export function transformComponents(components: readonly Polygon[], placement: PolygonPlacement): readonly Polygon[] {
  const rotated = components.map(p => p.map(v => rotatePoint(v, placement.rotation)));
  const bounds = getPolygonBounds(rotated.flat());
  return rotated.map(p => p.map(v => ({x:v.x - bounds.minX + placement.x,y:v.y - bounds.minY + placement.y})));
}

export function componentsOverlap(a: readonly Polygon[], b: readonly Polygon[]): boolean {
  return a.some(p => b.some(q => polygonsOverlap(p, q)));
}
