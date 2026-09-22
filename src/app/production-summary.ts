import type { BatchPieceDefinition } from '../domain/production-batch';
import { expandPieceDefinitions } from '../domain/piece-instance';
import type { FabricBatchResult } from '../export/export-plan';

export function summarizeProductionPlacement(
  definitions: readonly BatchPieceDefinition[],
  result: FabricBatchResult,
) {
  type PairCount = { front: number; back: number };
  const totalPairs = new Map<string, PairCount>();
  const placedPairs = new Map<string, PairCount>();
  const instances = new Map(
    expandPieceDefinitions(definitions).map((instance) => [instance.id, instance]),
  );
  let totalRequiredPngs = 0;
  let placedRequiredPngs = 0;

  const pairKey = (
    definition: Extract<BatchPieceDefinition, { kind: 'garment' }>,
  ) => JSON.stringify([definition.fabric, definition.model, definition.size]);
  const addSide = (
    map: Map<string, PairCount>,
    key: string,
    side: 'front' | 'back',
    amount: number,
  ) => {
    const count = map.get(key) ?? { front: 0, back: 0 };
    count[side] += amount;
    map.set(key, count);
  };

  for (const definition of definitions) {
    if (definition.fabric !== result.fabric) continue;
    if (definition.kind === 'free-png') {
      totalRequiredPngs += definition.quantity;
    } else {
      addSide(totalPairs, pairKey(definition), definition.side, definition.quantity);
    }
  }

  for (const layout of result.layouts) {
    for (const piece of layout.pieces) {
      if (piece.extra) continue;
      const definition = instances.get(piece.pieceId)?.definition;
      if (!definition || definition.fabric !== result.fabric) continue;
      if (definition.kind === 'free-png') {
        placedRequiredPngs += 1;
      } else {
        addSide(placedPairs, pairKey(definition), definition.side, 1);
      }
    }
  }

  const totalGarments = [...totalPairs.values()].reduce(
    (total, pair) => total + Math.min(pair.front, pair.back),
    0,
  );
  const placedGarments = [...placedPairs.values()].reduce(
    (total, pair) => total + Math.min(pair.front, pair.back),
    0,
  );

  return {
    placedGarments,
    totalGarments,
    placedRequiredPngs,
    totalRequiredPngs,
    complete:
      result.unplacedPieceIds.length === 0 &&
      placedGarments === totalGarments &&
      placedRequiredPngs === totalRequiredPngs,
  };
}
