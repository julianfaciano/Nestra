import type {
  BatchPieceDefinition,
  FreePngDefinition,
} from '../domain/production-batch';
import { mm } from '../domain/units';
import { physicalSizeFromSourcePixels } from '../domain/source-image-size';
import { expandPieceDefinitions } from '../domain/piece-instance';
import { groupPiecesByFabric } from '../domain/fabric-grouping';
import { getAllowedRotationsForPiece } from '../domain/piece-rotation';
import { DEFAULT_IMPRENTA_PROFILE } from '../domain/canvas-profile';
import { nestMultiplePieces } from '../geometry/multi-piece-nesting-engine';
import type { PreparedBatch } from '../export/export-plan';

export function freePngDefinition(quantity = 3): FreePngDefinition {
  const size = physicalSizeFromSourcePixels(72, 72);
  return {
    kind: 'free-png',
    id: 'logo',
    fileName: 'logo.png',
    imageUrl: 'blob:logo',
    fabric: 'deportiva',
    quantity,
    sourceWidthPx: 72,
    sourceHeightPx: 72,
    physicalWidthMm: mm(size.widthMm),
    physicalHeightMm: mm(size.heightMm),
    alphaThreshold: 16,
    simplificationTolerancePx: 3,
  };
}

export function prepareFreePngBatch(
  definitions: readonly BatchPieceDefinition[],
): PreparedBatch {
  const polygons = new Map(
    definitions.map((d) => [
      d.id,
      [
        { x: 0, y: 0 },
        { x: d.physicalWidthMm, y: 0 },
        { x: d.physicalWidthMm, y: d.physicalHeightMm },
        { x: 0, y: d.physicalHeightMm },
      ],
    ]),
  );
  return {
    definitions,
    polygons,
    profile: DEFAULT_IMPRENTA_PROFILE,
    results: groupPiecesByFabric(expandPieceDefinitions(definitions)).map(
      (group) => ({
        fabric: group.fabric,
        elapsedMs: 0,
        ...nestMultiplePieces({
          canvas: { width: 1480, height: 1000 },
          pieces: group.pieces.map((p) => ({
            id: p.id,
            polygon: polygons.get(p.definitionId)!,
            allowedRotations: getAllowedRotationsForPiece(p.definition),
          })),
        }),
      }),
    ),
  };
}
