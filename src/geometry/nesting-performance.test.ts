import { describe, expect, it } from 'vitest';
import {
  nestMultiplePieces,
  type MultiNestingPiece,
} from './multi-piece-nesting-engine';
import { polygonFitsInsideCanvas } from './canvas-geometry';
import { polygonsOverlap } from './polygon-collision';
import { transformPolygon, type PieceRotation } from './polygon-transform';
import type { Polygon } from './polygon';

const rectangle = (w: number, h: number): Polygon => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: h },
  { x: 0, y: h },
];
function verify(
  pieces: MultiNestingPiece[],
  canvas: { width: number; height: number },
) {
  const result = nestMultiplePieces({ pieces, canvas });
  for (const layout of result.layouts) {
    for (const [index, placed] of layout.pieces.entries()) {
      const original = pieces.find((piece) => piece.id === placed.pieceId)!;
      expect(original.allowedRotations).toContain(placed.placement.rotation);
      expect(placed.polygon).toEqual(
        transformPolygon(original.polygon, placed.placement),
      );
      expect(polygonFitsInsideCanvas(placed.polygon, canvas)).toBe(true);
      for (const other of layout.pieces.slice(index + 1)) {
        expect(polygonsOverlap(placed.polygon, other.polygon)).toBe(false);
      }
    }
  }
  return result;
}

describe('nesting performance and safety', () => {
  it('packs 582 repeated pieces with far fewer candidates than the previous grid', () => {
    const pieces: MultiNestingPiece[] = Array.from({ length: 582 }, (_, i) => ({
      id: String(i),
      polygon: rectangle(100, 100),
      allowedRotations: [0, 90, -90, 180],
    }));
    const result = verify(pieces, { width: 1480, height: 5000 });
    // Exact old-loop count for these squares: 14 per row; y/x every 10 mm;
    // all 4 rotations fail before the first successful position (rotation 0).
    const oldCandidateCount = pieces.reduce(
      (sum, _, i) =>
        sum + (Math.floor(i / 14) * 10 * 149 + (i % 14) * 10) * 4 + 1,
      0,
    );
    expect(result.placedCount).toBe(582);
    expect(result.layouts).toHaveLength(1);
    expect(result.diagnostics!.polygonTransforms).toBe(4);
    expect(result.diagnostics!.candidatePlacementsTested).toBeLessThan(
      oldCandidateCount / 100,
    );
    expect(result.diagnostics!.exactPolygonCollisionChecks).toBeLessThan(
      oldCandidateCount / 100,
    );
    expect(result.diagnostics!.broadPhaseChecks).toBeLessThan(
      result.diagnostics!.candidatePlacementsTested * 30,
    );
    expect(
      nestMultiplePieces({ pieces, canvas: { width: 1480, height: 5000 } }),
    ).toEqual(result);
  });

  it('keeps exact safety across buckets, rotations, fractional sizes and multiple canvases', () => {
    const concave: Polygon = [
      { x: 0, y: 0 },
      { x: 310.5, y: 0 },
      { x: 310.5, y: 110 },
      { x: 100, y: 110 },
      { x: 100, y: 430.5 },
      { x: 0, y: 430.5 },
    ];
    const pieces: MultiNestingPiece[] = Array.from({ length: 40 }, (_, i) => ({
      id: String(i),
      polygon: i % 2 ? concave : rectangle(230.5, 310.5),
      allowedRotations: i % 2 ? [0, 90, -90, 180] : [0, 180],
    }));
    pieces.push({
      id: 'impossible',
      polygon: rectangle(2000, 6000),
      allowedRotations: [0, 180],
    });
    const result = verify(pieces, { width: 1480, height: 1000 });
    expect(result.placedCount).toBe(40);
    expect(result.layouts.length).toBeGreaterThan(1);
    expect(result.unplacedPieceIds).toEqual(['impossible']);
    expect(result.diagnostics!.layoutsCreated).toBe(result.layouts.length);
    expect(result.diagnostics!.placedCount).toBe(40);
    expect(result.diagnostics!.exactPolygonCollisionChecks).toBeGreaterThan(0);
  });

  it.each<PieceRotation>([0, 90, -90, 180])(
    'preserves rotation %s and normalization',
    (rotation) => {
      const result = verify(
        [
          {
            id: 'offset',
            polygon: rectangle(210, 100).map((p) => ({
              x: p.x - 83,
              y: p.y + 7,
            })),
            allowedRotations: [rotation],
          },
        ],
        { width: 300, height: 300 },
      );
      expect(result.placedCount).toBe(1);
    },
  );

  it('allows exact touching and rejects positive area overlap', () => {
    const result = verify(
      Array.from({ length: 4 }, (_, i) => ({
        id: String(i),
        polygon: rectangle(100, 100),
        allowedRotations: [0],
      })),
      { width: 200, height: 200 },
    );
    expect(result.layouts).toHaveLength(1);
    expect(result.layouts[0]!.pieces.map((p) => p.placement)).toEqual([
      { x: 0, y: 0, rotation: 0 },
      { x: 100, y: 0, rotation: 0 },
      { x: 0, y: 100, rotation: 0 },
      { x: 100, y: 100, rotation: 0 },
    ]);
    expect(
      polygonsOverlap(
        rectangle(100, 100),
        transformPolygon(rectangle(100, 100), { x: 99.99, y: 0, rotation: 0 }),
      ),
    ).toBe(true);
  });

  it('permits diagonal touching with AABBs that overlap', () => {
    const triangle: Polygon = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 0, y: 200 },
    ];
    const result = verify(
      [
        { id: 'a', polygon: triangle, allowedRotations: [0] },
        { id: 'b', polygon: triangle, allowedRotations: [180] },
      ],
      { width: 200, height: 200 },
    );
    expect(result.layouts).toHaveLength(1);
    expect(result.placedCount).toBe(2);
    expect(result.diagnostics!.exactPolygonCollisionChecks).toBeGreaterThan(0);
  });
});

it('does not expand the search into unused Calandra height', () => {
  const pieces: MultiNestingPiece[] = Array.from({ length: 20 }, (_, i) => ({
    id: String(i),
    polygon: rectangle(100, 100),
    allowedRotations: [0, 180],
  }));
  const short = nestMultiplePieces({
    pieces,
    canvas: { width: 1480, height: 1000 },
  });
  const tall = nestMultiplePieces({
    pieces,
    canvas: { width: 1480, height: 5000 },
  });
  expect(tall).toEqual(short);
});

it('keeps empty jobs serializable with additive diagnostics', () => {
  const result = nestMultiplePieces({
    pieces: [],
    canvas: { width: 1480, height: 5000 },
  });
  expect(result.layouts).toEqual([]);
  expect(result.placedCount).toBe(0);
  expect(result.diagnostics!.candidatePlacementsTested).toBe(0);
  expect(JSON.parse(JSON.stringify(result))).toEqual(result);
});
