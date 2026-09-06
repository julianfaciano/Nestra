import type { Polygon } from './polygon';
import {
  getPolygonBounds,
  rotatePoint,
  type PolygonPlacement,
  type PieceRotation,
  type PolygonBounds,
} from './polygon-transform';

export function prepareArtworkBounds(
  polygon: Polygon,
  rotation: PieceRotation,
  size: { width: number; height: number },
) {
  return {
    polygon: getPolygonBounds(
      polygon.map((point) => rotatePoint(point, rotation)),
    ),
    image: getPolygonBounds(
      [
        { x: 0, y: 0 },
        { x: size.width, y: 0 },
        { x: size.width, y: size.height },
        { x: 0, y: size.height },
      ].map((point) => rotatePoint(point, rotation)),
    ),
  };
}

export function placeArtworkBounds(
  variant: ReturnType<typeof prepareArtworkBounds>,
  placement: PolygonPlacement,
): PolygonBounds {
  // Preserve the exporter's arithmetic order, including fractional PNG margins.
  const tx = placement.x - variant.polygon.minX,
    ty = placement.y - variant.polygon.minY;
  const minX = variant.image.minX + tx,
    maxX = variant.image.maxX + tx;
  const minY = variant.image.minY + ty,
    maxY = variant.image.maxY + ty;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/** Same source-to-placement transform used by the production export plan. */
export function artworkBounds(
  polygon: Polygon,
  placement: PolygonPlacement,
  size: { width: number; height: number },
) {
  return placeArtworkBounds(
    prepareArtworkBounds(polygon, placement.rotation, size),
    placement,
  );
}
