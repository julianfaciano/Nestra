export const PIECE_SIDES = ['front', 'back'] as const;

export type PieceSide = (typeof PIECE_SIDES)[number];

export function getPieceSideLabel(side: PieceSide): string {
  return side === 'front' ? 'Frente' : 'Dorso';
}
