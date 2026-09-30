import { expect, it } from 'vitest';
import { groupPiecesByFabric } from './fabric-grouping';
import { expandPieceDefinitions } from './piece-instance';
import { getAllowedRotationsForPiece } from './piece-rotation';
import type { ReplacementPieceDefinition } from './production-batch';
import { mm } from './units';

function replacement(overrides: Partial<ReplacementPieceDefinition> = {}): ReplacementPieceDefinition {
  return {
    kind: 'replacement-piece',
    id: 'replacement',
    collectionId: 'collection-a',
    model: 'Argentina 2026',
    size: 'T8',
    side: 'back',
    fabric: 'set',
    quantity: 2,
    fileName: 'Argentina_T8_D.png',
    imageUrl: 'blob:library-source',
    sourceWidthPx: 100,
    sourceHeightPx: 120,
    physicalWidthMm: mm(80),
    physicalHeightMm: mm(96),
    alphaThreshold: 16,
    simplificationTolerancePx: 3,
    ...overrides,
  };
}

it('expands a standalone replacement by quantity without a counterpart', () => {
  const instances = expandPieceDefinitions([replacement()]);
  expect(instances.map(instance => instance.id)).toEqual(['replacement-1', 'replacement-2']);
  expect(instances.every(instance => instance.definition.kind === 'replacement-piece')).toBe(true);
});

it('uses the garment rotation rules for replacement sides', () => {
  expect(getAllowedRotationsForPiece(replacement({ side: 'front' }))).toEqual([0, 90, 180, -90]);
  expect(getAllowedRotationsForPiece(replacement({ side: 'back' }))).toEqual([0, 180]);
});

it('keeps replacements on shared fabric layouts and separates different fabrics', () => {
  const groups = groupPiecesByFabric([
    ...expandPieceDefinitions([replacement(), replacement({ id: 'other-design', collectionId: 'collection-b', model: 'Boca 2026', size: 'T5', side: 'front', quantity: 1 })]),
    ...expandPieceDefinitions([replacement({ id: 'polar-piece', fabric: 'polar', quantity: 1 })]),
  ]);
  expect(groups.map(group => [group.fabric, group.pieces.length])).toEqual([['set', 3], ['polar', 1]]);
});
