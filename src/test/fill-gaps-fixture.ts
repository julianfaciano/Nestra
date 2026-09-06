import { nestMultiplePieces } from '../geometry/multi-piece-nesting-engine';
import { expandPieceDefinitions } from '../domain/piece-instance';
import { groupPiecesByFabric } from '../domain/fabric-grouping';
import { fillersForInstances } from '../domain/fill-gaps';
import { getAllowedRotationsForPiece } from '../domain/piece-rotation';
import type {
  BatchPieceDefinition,
  FreePngDefinition,
} from '../domain/production-batch';
import { mm } from '../domain/units';
import type { PreparedBatch } from '../export/export-plan';
import { DEFAULT_IMPRENTA_PROFILE } from '../domain/canvas-profile';

export const rect = (width: number, height: number) => [
  { x: 0, y: 0 },
  { x: width, y: 0 },
  { x: width, y: height },
  { x: 0, y: height },
];

export function fillDefinition(
  id: string,
  width: number,
  height: number,
  quantity = 1,
  priority?: number,
): FreePngDefinition {
  return {
    kind: 'free-png',
    id,
    fileName: `${id}.png`,
    imageUrl: `blob:${id}`,
    fabric: 'deportiva',
    quantity,
    physicalWidthMm: mm(width),
    physicalHeightMm: mm(height),
    sourceWidthPx: 100,
    sourceHeightPx: 100,
    alphaThreshold: 16,
    simplificationTolerancePx: 3,
    ...(priority ? { fill: { priority, mode: 'normal' as const } } : {}),
  };
}

export function fillBatch(
  definitions: readonly BatchPieceDefinition[],
  enabled = true,
): PreparedBatch {
  const polygons = new Map(
    definitions.map((d) => [d.id, rect(d.physicalWidthMm, d.physicalHeightMm)]),
  );
  return {
    definitions,
    polygons,
    profile: {
      ...DEFAULT_IMPRENTA_PROFILE,
      maxWidth: mm(100),
      maxHeight: mm(200),
    },
    results: groupPiecesByFabric(expandPieceDefinitions(definitions)).map(
      (group) => ({
        fabric: group.fabric,
        elapsedMs: 0,
        ...nestMultiplePieces({
          canvas: { width: 100, height: 200 },
          scanStepMm: 10,
          ...(enabled ? { fillers: fillersForInstances(group.pieces) } : {}),
          pieces: group.pieces.map((p) => ({
            id: p.id,
            polygon: polygons.get(p.definitionId)!,
            artworkSize: {
              width: p.definition.physicalWidthMm,
              height: p.definition.physicalHeightMm,
            },
            allowedRotations: getAllowedRotationsForPiece(p.definition),
          })),
        }),
      }),
    ),
  };
}
