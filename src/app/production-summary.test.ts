import { describe, expect, it } from 'vitest';
import type { BatchPieceDefinition } from '../domain/production-batch';
import { mm } from '../domain/units';
import type { FabricBatchResult } from '../export/export-plan';
import { summarizeProductionPlacement } from './production-summary';

const base = {
  fabric: 'set',
  quantity: 1,
  fileName: 'piece.png',
  imageUrl: 'blob:piece',
  sourceWidthPx: 100,
  sourceHeightPx: 100,
  physicalWidthMm: mm(100),
  physicalHeightMm: mm(100),
  alphaThreshold: 16,
  simplificationTolerancePx: 1.5,
} as const;

const definitions: BatchPieceDefinition[] = [
  { ...base, kind: 'garment', id: 'front', model: 'Adoptame', size: 'T1', side: 'front' },
  { ...base, kind: 'garment', id: 'back', model: 'Adoptame', size: 'T1', side: 'back' },
  { ...base, kind: 'free-png', id: 'logo', fileName: 'logo.png' },
];

function result(pieceIds: readonly string[], unplacedPieceIds: readonly string[]): FabricBatchResult {
  return {
    fabric: 'set',
    elapsedMs: 10,
    unplacedPieceIds,
    layouts: [
      {
        index: 0,
        usedWidth: 100,
        usedHeight: 100,
        pieces: pieceIds.map((pieceId) => ({
          pieceId,
          placement: { x: 0, y: 0, rotation: 0 },
          polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
        })),
      },
    ],
  };
}

describe('summarizeProductionPlacement', () => {
  it('cuenta un frente + un dorso como una prenda y no suma PNG', () => {
    expect(summarizeProductionPlacement(definitions, result(['front-1', 'back-1', 'logo-1'], []))).toEqual({
      placedGarments: 1,
      totalGarments: 1,
      placedRequiredPngs: 1,
      totalRequiredPngs: 1,
      complete: true,
    });
  });

  it('no afirma completitud si falta un PNG requerido', () => {
    expect(summarizeProductionPlacement(definitions, result(['front-1', 'back-1'], ['logo-1']))).toMatchObject({
      placedGarments: 1,
      totalGarments: 1,
      placedRequiredPngs: 0,
      totalRequiredPngs: 1,
      complete: false,
    });
  });
});
