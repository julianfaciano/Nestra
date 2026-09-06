import type { PieceInstance } from './piece-instance';

export interface FabricGroup {
  readonly fabric: string;
  readonly pieces: readonly PieceInstance[];
}

function normalizeFabricName(value: string): string {
  return value.trim().toLowerCase();
}

export function groupPiecesByFabric(
  pieces: readonly PieceInstance[],
): FabricGroup[] {
  const groups = new Map<string, PieceInstance[]>();

  for (const piece of pieces) {
    const fabric = normalizeFabricName(piece.definition.fabric);

    if (fabric.length === 0) {
      throw new Error(`La pieza ${piece.id} no tiene un tipo de tela válido.`);
    }

    const current = groups.get(fabric) ?? [];
    current.push(piece);
    groups.set(fabric, current);
  }

  return [...groups.entries()].map(([fabric, groupedPieces]) => ({
    fabric,
    pieces: groupedPieces,
  }));
}
