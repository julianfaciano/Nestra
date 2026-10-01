import {
  DEFAULT_IMPRENTA_2_PROFILE,
  LASER_CUT_OUTLINE_WIDTH_MM,
  outlineExtentMm,
  type CanvasProfile,
} from '../domain/canvas-profile';
import { fillDefinition, rect } from './fill-gaps-fixture';
import type { PreparedBatch } from '../export/export-plan';
import { transformPolygon } from '../geometry/polygon-transform';

export function laserBatch(
  visibleGapMm = 3,
  profile: CanvasProfile = DEFAULT_IMPRENTA_2_PROFILE,
): PreparedBatch {
  const definition = fillDefinition('cut', 20, 20, 2);
  const polygon = rect(20, 20);
  const extent = outlineExtentMm(profile);
  const nominalGap = visibleGapMm + (profile.laserCutOutline ? LASER_CUT_OUTLINE_WIDTH_MM : 0);
  const placements = [
    { x: extent, y: extent, rotation: 0 as const },
    { x: 20 + extent + nominalGap, y: extent, rotation: 0 as const },
  ];
  return {
    profile,
    definitions: [definition],
    polygons: new Map([['cut', polygon]]),
    cutComponents: new Map([['cut', [polygon]]]),
    results: [
      {
        fabric: definition.fabric,
        elapsedMs: 0,
        unplacedPieceIds: [],
        layouts: [
          {
            index: 0,
            usedWidth: 40 + 2 * extent + nominalGap,
            usedHeight: 20 + extent,
            pieces: placements.map((placement, i) => ({
              pieceId: `cut-${i + 1}`,
              placement,
              polygon: transformPolygon(polygon, placement),
            })),
          },
        ],
      },
    ],
  };
}
