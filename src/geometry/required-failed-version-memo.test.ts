import { expect, it } from 'vitest';
import { nestMultiplePieces, type MultiNestingInput } from './multi-piece-nesting-engine';
import { componentsOverlap } from './polygon-components';
import { polygonsTouch } from './polygon-contact';
import { getPolygonBounds } from './polygon-transform';

function rect(width: number, height: number) {
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
}

it('does not reuse a grid-only failed version for a later contact-exact required piece', () => {
  const polygon = rect(13, 10);
  const result = nestMultiplePieces({
    canvas: { width: 26, height: 10 },
    scanStepMm: 10,
    pieces: [
      { id: 'a', polygon, allowedRotations: [0] },
      { id: 'b', polygon, allowedRotations: [0] },
      { id: 'c', kind: 'garment', polygon, allowedRotations: [0] },
    ],
  });

  expect(result.layouts).toHaveLength(2);
  expect(result.layouts[0]!.pieces.map((piece) => ({
    id: piece.pieceId,
    ...piece.placement,
  }))).toEqual([
    { id: 'a', x: 0, y: 0, rotation: 0 },
    { id: 'c', x: 13, y: 0, rotation: 0 },
  ]);
  expect(result.layouts[1]!.pieces.map((piece) => piece.pieceId)).toEqual(['b']);
});

it('reuses an exhausted failed version for the same contact-exact search mode', () => {
  const polygon = rect(17, 10);
  const result = nestMultiplePieces({
    canvas: { width: 26, height: 10 },
    scanStepMm: 10,
    pieces: [
      { id: 'a', kind: 'garment', polygon, allowedRotations: [0] },
      { id: 'b', kind: 'garment', polygon, allowedRotations: [0] },
      { id: 'c', kind: 'free-png', polygon, allowedRotations: [0] },
    ],
  });

  expect(result.layouts).toHaveLength(3);
  expect(result.diagnostics!.requiredFailedVersionHits).toBeGreaterThan(0);
});

it('keeps a deterministic mixed garment, free-PNG, MAX and NORMAL job valid', () => {
  const largePolygon = rect(60, 50);
  const maxPolygon = rect(20, 20);
  const normalPolygon = rect(10, 10);
  const input: MultiNestingInput = {
    canvas: { width: 100, height: 50 },
    scanStepMm: 10,
    pieces: [
      { id: 'garment-a', kind: 'garment', polygon: largePolygon, allowedRotations: [0] },
      { id: 'garment-b', kind: 'garment', polygon: largePolygon, allowedRotations: [0] },
      { id: 'png-large', kind: 'free-png', polygon: largePolygon, allowedRotations: [0] },
      {
        id: 'max-source',
        kind: 'free-png',
        polygon: maxPolygon,
        collisionComponents: [maxPolygon],
        allowedRotations: [0],
      },
      {
        id: 'normal-source',
        kind: 'free-png',
        polygon: normalPolygon,
        collisionComponents: [normalPolygon],
        allowedRotations: [0],
      },
    ],
    fillers: [
      { definitionId: 'max', requiredPieceId: 'max-source', priority: 1, mode: 'max' },
      { definitionId: 'normal', requiredPieceId: 'normal-source', priority: 2, mode: 'normal' },
    ],
  };

  const result = nestMultiplePieces(input);
  expect(nestMultiplePieces(input)).toEqual(result);
  const reference = nestMultiplePieces({
    ...input,
    pieces: input.pieces.map((piece) => piece.id === 'garment-b'
      ? { ...piece, allowedRotations: [0, 0] }
      : piece),
  });
  const functional = ({ diagnostics: _diagnostics, ...value }: ReturnType<typeof nestMultiplePieces>) => value;
  expect(functional(result)).toEqual(functional(reference));
  expect(result.unplacedPieceIds).toEqual([]);
  expect(result.placedCount).toBe(input.pieces.length);
  expect(result.totalPieceCount).toBe(input.pieces.length);
  expect(result.layouts).toHaveLength(3);
  expect(result.diagnostics!.requiredFailedVersionHits).toBeGreaterThan(0);

  const pieces = result.layouts.flatMap((layout) => layout.pieces);
  for (const layout of result.layouts) {
    expect(layout.usedHeight).toBe(layout.requiredUsedHeight);
    for (const [index, piece] of layout.pieces.entries()) {
      expect(getPolygonBounds(piece.polygon).maxY).toBeLessThanOrEqual(layout.requiredUsedHeight!);
      for (const other of layout.pieces.slice(index + 1)) {
        expect(componentsOverlap(
          piece.collisionComponents ?? [piece.polygon],
          other.collisionComponents ?? [other.polygon],
        )).toBe(false);
      }
    }
  }
  expect(result.layouts.some((layout) => layout.pieces.some((piece, index) =>
    layout.pieces.slice(index + 1).some((other) => polygonsTouch(piece.polygon, other.polygon))))).toBe(true);

  const extras = pieces.filter((piece) => piece.extra);
  expect(new Set(extras.map((piece) => piece.extra!.definitionId))).toEqual(new Set(['max', 'normal']));
  expect(new Set(pieces.map((piece) => piece.pieceId)).size).toBe(pieces.length);
  expect(extras.every((piece) => piece.pieceId ===
    `extra:${piece.extra!.definitionId}:${piece.extra!.copyIndex + 1}`)).toBe(true);
});
