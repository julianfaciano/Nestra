import type { PieceSide } from './piece-side';
import type { PieceRotation } from '../geometry/polygon-transform';
import type { BatchPieceDefinition } from './production-batch';

export function getAllowedRotationsForPiece(
  piece: BatchPieceDefinition,
): readonly PieceRotation[] {
  return piece.kind === 'free-png'
    ? [0, 90, -90, 180]
    : getAllowedRotationsForSide(piece.side);
}

export function getAllowedRotationsForSide(
  side: PieceSide,
): readonly PieceRotation[] {
  return side === 'front' ? [0, 90, 180, -90] : [0, 180];
}
