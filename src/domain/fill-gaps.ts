import type { PieceInstance } from './piece-instance';
import type { BatchPieceDefinition } from './production-batch';
import type { MultiNestingLayout } from '../geometry/multi-piece-nesting-engine';
import type { FillerRequest } from '../geometry/filler-types';

/** Absence means disabled. Re-enabling creates a fresh monotonic priority. */
export interface FillSetting {
  readonly priority: number;
  readonly mode: 'normal' | 'max';
}

export function toggleFill<
  T extends { readonly id: string; readonly fill?: FillSetting | undefined },
>(
  pieces: readonly T[],
  id: string,
  lastPriority: number,
): { pieces: T[]; lastPriority: number } {
  const piece = pieces.find((item) => item.id === id);
  if (!piece) return { pieces: [...pieces], lastPriority };
  if (piece.fill?.mode === 'normal') {
    return {
      pieces: pieces.map((item) =>
        item.id === id
          ? { ...item, fill: { ...item.fill!, mode: 'max' as const } }
          : item,
      ),
      lastPriority,
    };
  }
  const next = piece.fill ? lastPriority : lastPriority + 1;
  if (!Number.isSafeInteger(next)) throw new Error('Prioridad de relleno fuera de rango.');
  return {
    pieces: pieces.map((item) =>
      item.id === id
        ? { ...item, fill: item.fill ? undefined : { priority: next, mode: 'normal' as const } }
        : item,
    ),
    lastPriority: next,
  };
}

/** Receives an already partitioned fabric group, so no other fabric enters its Worker. */
export function fillersForInstances(
  instances: readonly PieceInstance[],
): FillerRequest[] {
  return instances
    .flatMap((instance) =>
      instance.copyIndex === 0 &&
      instance.definition.kind === 'free-png' &&
      instance.definition.fill
        ? [
            {
              definitionId: instance.definitionId,
              requiredPieceId: instance.id,
              priority: instance.definition.fill.priority,
              mode: instance.definition.fill.mode,
            },
          ]
        : [],
    )
    .sort((a, b) => a.priority - b.priority);
}

export function extraCounts(
  results: readonly { readonly layouts: readonly MultiNestingLayout[] }[],
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const result of results)
    for (const layout of result.layouts)
      for (const piece of layout.pieces) {
        if (piece.extra)
          counts.set(
            piece.extra.definitionId,
            (counts.get(piece.extra.definitionId) ?? 0) + 1,
          );
      }
  return counts;
}

export interface PngPieceSummary {
  readonly name: string;
  readonly count: number;
  readonly fabric: string;
}

export function pngPieceSummaries(
  definitions: readonly BatchPieceDefinition[],
  counts?: ReadonlyMap<string, number>,
): PngPieceSummary[] {
  const grouped = new Map<string, PngPieceSummary>();
  for (const piece of definitions) {
    if (piece.kind !== 'free-png') continue;
    const count = counts ? (counts.get(piece.id) ?? 0) : piece.quantity;
    if (count <= 0) continue;
    const key = JSON.stringify([piece.fileName, piece.fabric]);
    grouped.set(key, {
      name: piece.fileName,
      fabric: piece.fabric,
      count: count + (grouped.get(key)?.count ?? 0),
    });
  }
  return [...grouped.values()];
}
