export const MAX_BATCH_PIECES = 5000;

export function batchPieceLimitError(totalPieces: number): string | null {
  return totalPieces > MAX_BATCH_PIECES
    ? `Máximo ${MAX_BATCH_PIECES} piezas por batch en esta versión.`
    : null;
}
