import { expect, it } from 'vitest';
import {
  nestMultiplePieces,
  type MultiNestingInput,
} from './multi-piece-nesting-engine';
import { polygonsOverlap } from './polygon-collision';
import { getPolygonBounds, transformPolygon } from './polygon-transform';
import { rect } from '../test/fill-gaps-fixture';

function input(): MultiNestingInput {
  return {
    canvas: { width: 100, height: 200 },
    scanStepMm: 10,
    pieces: [
      { id: 'base', polygon: rect(60, 100), allowedRotations: [0] },
      ...Array.from({ length: 3 }, (_, i) => ({
        id: `a-${i + 1}`,
        polygon: rect(20, 20),
        allowedRotations: [0, 90, -90, 180] as const,
      })),
    ],
  };
}
const filler = { definitionId: 'a', requiredPieceId: 'a-1', priority: 1, mode: 'normal' as const };

it('leaves the entire result unchanged when no fillers are requested', () => {
  expect(nestMultiplePieces({ ...input(), fillers: [] })).toEqual(
    nestMultiplePieces(input()),
  );
});

it('adds seven extras separately from three required copies without changing layouts, heights or meters', () => {
  const original = input();
  const before = structuredClone(original);
  const required = nestMultiplePieces(original);
  const filled = nestMultiplePieces({ ...original, fillers: [filler] });
  expect(original).toEqual(before);
  expect(filled.layouts).toHaveLength(required.layouts.length);
  expect(filled.placedCount).toBe(4);
  expect(filled.totalPieceCount).toBe(4);
  expect(filled.extraCount).toBe(7);
  expect(
    filled.layouts
      .flatMap((l) => l.pieces)
      .filter((p) => !p.extra && p.pieceId.startsWith('a-')),
  ).toHaveLength(3);
  expect(filled.layouts.map((l) => l.usedHeight)).toEqual(
    required.layouts.map((l) => l.usedHeight),
  );
  expect(filled.layouts.reduce((sum, l) => sum + l.usedHeight / 1000, 0)).toBe(
    required.layouts.reduce((sum, l) => sum + l.usedHeight / 1000, 0),
  );
  for (const [i, layout] of filled.layouts.entries()) {
    expect(layout.pieces.filter((p) => !p.extra)).toEqual(
      required.layouts[i]!.pieces,
    );
    expect(layout.requiredUsedHeight).toBe(required.layouts[i]!.usedHeight);
    for (const [j, piece] of layout.pieces.entries()) {
      const bounds = getPolygonBounds(piece.polygon);
      expect(bounds.minX).toBeGreaterThanOrEqual(0);
      expect(bounds.minY).toBeGreaterThanOrEqual(0);
      expect(bounds.maxX).toBeLessThanOrEqual(100);
      expect(bounds.maxY).toBeLessThanOrEqual(layout.requiredUsedHeight!);
      if (piece.extra)
        expect([0, 90, -90, 180]).toContain(piece.placement.rotation);
      for (const other of layout.pieces.slice(j + 1))
        expect(polygonsOverlap(piece.polygon, other.polygon)).toBe(false);
    }
  }
  const extras = filled.layouts.flatMap((l) => l.pieces).filter((p) => p.extra);
  expect(extras.map((p) => p.extra!.copyIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  expect(
    new Set(filled.layouts.flatMap((l) => l.pieces.map((p) => p.pieceId))).size,
  ).toBe(11);
  expect(nestMultiplePieces({ ...original, fillers: [filler] })).toEqual(
    filled,
  );
});

it('fills active fillers in round-robin order and then removes exhausted fillers', () => {
  const data: MultiNestingInput = {
    ...input(),
    pieces: [
      input().pieces[0]!,
      input().pieces[1]!,
      { id: 'b-1', polygon: rect(10, 10), allowedRotations: [0, 90, -90, 180] },
    ],
    fillers: [
      filler,
      { definitionId: 'b', requiredPieceId: 'b-1', priority: 2, mode: 'normal' as const },
    ],
  };
  const filled = nestMultiplePieces(data);
  const extras = filled.layouts
    .flatMap((l) => l.pieces)
    .filter((p) => p.extra)
    .map((p) => p.extra!.definitionId);
  expect(extras.slice(0, 6)).toEqual(['a', 'b', 'a', 'b', 'a', 'b']);
  expect(new Set(extras)).toEqual(new Set(['a', 'b']));
  const reversed = nestMultiplePieces({
    ...data,
    fillers: [
      { ...filler, priority: 2 },
      { definitionId: 'b', requiredPieceId: 'b-1', priority: 1, mode: 'normal' as const },
    ],
  });
  const reversedExtras = reversed.layouts
    .flatMap((l) => l.pieces)
    .filter((p) => p.extra)
    .map((p) => p.extra!.definitionId);
  expect(reversedExtras.slice(0, 4)).toEqual(['b', 'a', 'b', 'a']);
});

it('does not create new layouts when none of the existing material has room', () => {
  const data: MultiNestingInput = {
    canvas: { width: 100, height: 200 },
    pieces: [
      {
        id: 'a-1',
        polygon: rect(100, 100),
        allowedRotations: [0, 90, -90, 180],
      },
    ],
    fillers: [filler],
  };
  const result = nestMultiplePieces(data);
  expect(result.extraCount).toBe(0);
  expect(result.layouts).toHaveLength(1);
  expect(result.layouts[0]!.usedHeight).toBe(100);
});

it('supports more than 100 extras without an arbitrary cap', () => {
  const result = nestMultiplePieces({
    canvas: { width: 100, height: 100 },
    scanStepMm: 5,
    pieces: [
      { id: 'base', polygon: rect(40, 100), allowedRotations: [0] },
      { id: 'a-1', polygon: rect(5, 5), allowedRotations: [0] },
    ],
    fillers: [filler],
  });
  expect(result.extraCount).toBe(239);
  expect(result.layouts).toHaveLength(1);
  expect(result.layouts[0]!.usedHeight).toBe(100);
});

it('rejects degenerate fillers as non-consuming without looping', () => {
  const result = nestMultiplePieces({
    canvas: { width: 100, height: 100 },
    pieces: [
      {
        id: 'a-1',
        polygon: [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 40, y: 0 },
        ],
        allowedRotations: [0],
      },
    ],
    fillers: [filler],
  });
  expect(result.extraCount).toBe(0);
});

it('checks the fine contour against frozen height and both required and extra neighbors', () => {
  const data: MultiNestingInput = {
    ...input(),
    pieces: [
      input().pieces[0]!,
      {
        ...input().pieces[1]!,
        finePolygon: rect(21, 21),
      },
    ],
    fillers: [filler],
  };
  const result = nestMultiplePieces(data);
  expect(result.extraCount).toBeGreaterThan(0);
  for (const layout of result.layouts)
    for (const p of layout.pieces.filter((p) => p.extra)) {
      expect(p.placement.y + 21).toBeLessThanOrEqual(
        layout.requiredUsedHeight!,
      );
    }
  for (const layout of result.layouts) {
    const fine = layout.pieces.map((p) =>
      transformPolygon(
        p.pieceId === 'base' ? rect(60, 100) : rect(21, 21),
        p.placement,
      ),
    );
    for (const [i, polygon] of fine.entries())
      for (const other of fine.slice(i + 1))
        expect(polygonsOverlap(polygon, other)).toBe(false);
  }
});

it('fills concave alpha holes instead of treating the required piece as a solid rectangle', () => {
  const result = nestMultiplePieces({
    canvas: { width: 100, height: 200 },
    scanStepMm: 20,
    pieces: [
      {
        id: 'base',
        polygon: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 20 },
          { x: 20, y: 20 },
          { x: 20, y: 100 },
          { x: 0, y: 100 },
        ],
        allowedRotations: [0],
      },
      { id: 'a-1', polygon: rect(20, 20), allowedRotations: [0, 90, -90, 180] },
    ],
    fillers: [filler],
  });
  expect(result.extraCount).toBe(15);
  expect(result.layouts[0]!.usedHeight).toBe(100);
});

it('rotates extras when a quarter turn is needed to fit the existing strip', () => {
  const result = nestMultiplePieces({
    canvas: { width: 100, height: 200 },
    scanStepMm: 10,
    pieces: [
      { id: 'base', polygon: rect(80, 100), allowedRotations: [0] },
      { id: 'a-1', polygon: rect(40, 20), allowedRotations: [0, 90, -90, 180] },
    ],
    fillers: [filler],
  });
  expect(result.extraCount).toBe(1);
  expect(
    result.layouts[0]!.pieces.find((p) => p.extra)!.placement.rotation,
  ).toBe(90);
});

it('keeps stable copy indices for each filler across all existing canvases', () => {
  const data: MultiNestingInput = {
    canvas: { width: 100, height: 100 },
    scanStepMm: 10,
    pieces: [
      { id: 'base1', polygon: rect(60, 100), allowedRotations: [0] },
      { id: 'base2', polygon: rect(60, 100), allowedRotations: [0] },
      { id: 'a-1', polygon: rect(20, 20), allowedRotations: [0] },
      { id: 'b-1', polygon: rect(20, 20), allowedRotations: [0] },
    ],
    fillers: [
      filler,
      { definitionId: 'b', requiredPieceId: 'b-1', priority: 2, mode: 'normal' as const },
    ],
  };
  const result = nestMultiplePieces(data);
  expect(result.layouts).toHaveLength(2);
  expect(result.layouts.map((l) => l.usedHeight)).toEqual([100, 100]);
  const extras = result.layouts.flatMap((l) => l.pieces).filter((p) => p.extra);
  expect(extras).toHaveLength(18);
  const byDefinition = new Map<string, number[]>();
  for (const piece of extras) {
    const definitionId = piece.extra!.definitionId;
    const indices = byDefinition.get(definitionId) ?? [];
    indices.push(piece.extra!.copyIndex);
    byDefinition.set(definitionId, indices);
  }
  expect(byDefinition.size).toBe(2);
  for (const indices of byDefinition.values()) {
    expect(indices.sort((a, b) => a - b)).toEqual(
      Array.from({ length: indices.length }, (_, i) => i),
    );
  }
});

it('exhausts MAX fillers before normal round-robin fillers without changing material', () => {
  const result = nestMultiplePieces({
    canvas: { width: 100, height: 100 },
    scanStepMm: 10,
    pieces: [
      { id: 'base', polygon: rect(60, 100), allowedRotations: [0] },
      { id: 'a-1', polygon: rect(20, 20), allowedRotations: [0] },
      { id: 'b-1', polygon: rect(20, 20), allowedRotations: [0] },
    ],
    fillers: [
      { definitionId: 'a', requiredPieceId: 'a-1', priority: 1, mode: 'normal' },
      { definitionId: 'b', requiredPieceId: 'b-1', priority: 2, mode: 'max' },
    ],
  });
  const extras = result.layouts.flatMap((layout) => layout.pieces).filter((piece) => piece.extra);
  const firstNormal = extras.findIndex((piece) => piece.extra!.definitionId === 'a');
  expect(extras.some((piece) => piece.extra!.definitionId === 'b')).toBe(true);
  if (firstNormal >= 0) {
    expect(extras.slice(0, firstNormal).every((piece) => piece.extra!.definitionId === 'b')).toBe(true);
  }
  expect(result.layouts.every((layout) => layout.usedHeight === layout.requiredUsedHeight)).toBe(true);
  expect(nestMultiplePieces({
    canvas: { width: 100, height: 100 },
    scanStepMm: 10,
    pieces: [
      { id: 'base', polygon: rect(60, 100), allowedRotations: [0] },
      { id: 'a-1', polygon: rect(20, 20), allowedRotations: [0] },
      { id: 'b-1', polygon: rect(20, 20), allowedRotations: [0] },
    ],
    fillers: [
      { definitionId: 'a', requiredPieceId: 'a-1', priority: 1, mode: 'normal' },
      { definitionId: 'b', requiredPieceId: 'b-1', priority: 2, mode: 'max' },
    ],
  })).toEqual(result);
});
