import { describe, expect, it } from 'vitest';
import {
  minimumContourDistance,
  contoursViolateClearance,
} from './polygon-clearance';
import {
  nestMultiplePieces,
  type MultiNestingInput,
} from './multi-piece-nesting-engine';
import { getPolygonBounds, transformPolygon } from './polygon-transform';
import type { Polygon } from './polygon';
import { rect } from '../test/fill-gaps-fixture';
import { componentEnvelope } from './polygon-components';
import {
  DEFAULT_IMPRENTA_2_PROFILE,
  LASER_CUT_OUTLINE_WIDTH_MM,
  nominalSilhouetteClearanceMm,
  nestingCanvasForProfile,
} from '../domain/canvas-profile';

const move = (p: Polygon, x: number, y = 0): Polygon =>
  p.map((v) => ({ x: v.x + x, y: v.y + y }));

describe('visible stroke gap and nominal silhouette clearance', () => {
  it('uses the extra 80 mm of laser canvas and contains the exterior stroke on all four sides', () => {
    const canvas = nestingCanvasForProfile(DEFAULT_IMPRENTA_2_PROFILE);
    const polygon = rect(1530, 30);
    const result = nestMultiplePieces({ canvas, pieces: [{ id: 'wide', polygon, cutComponents: [polygon], allowedRotations: [0] }] });
    expect(result.unplacedPieceIds).toEqual([]);
    const bounds = getPolygonBounds(result.layouts[0]!.pieces[0]!.cutComponents!.flat());
    expect(bounds.minX - 1.5).toBeGreaterThanOrEqual(-1e-9);
    expect(bounds.minY - 1.5).toBeGreaterThanOrEqual(-1e-9);
    expect(bounds.maxX + 1.5).toBeLessThanOrEqual(canvas.width + 1e-9);
    expect(bounds.maxY + 1.5).toBeLessThanOrEqual(canvas.height + 1e-9);
    expect(bounds.maxX).toBeGreaterThan(1480);
    expect(canvas.width).toBeLessThanOrEqual(1560);
  });
  const nominalClearance = nominalSilhouetteClearanceMm(
    DEFAULT_IMPRENTA_2_PROFILE,
  );
  expect(nominalClearance).toBe(6);
  it.each([
    [2.999, 5.999, true],
    [3, 6, false],
    [3.001, 6.001, false],
  ] as const)(
    'visible gap %s mm (nominal distance %s mm): rejected=%s',
    (visibleGap, nominalDistance, invalid) => {
      const a = rect(20, 20),
        b = move(a, 20 + nominalDistance);
      expect(minimumContourDistance([a], [b])).toBeCloseTo(nominalDistance, 10);
      expect(nominalDistance - LASER_CUT_OUTLINE_WIDTH_MM).toBeCloseTo(
        visibleGap,
        10,
      );
      expect(contoursViolateClearance([a], [b], nominalClearance)).toBe(invalid);
    },
  );
  it('derives 6 mm nominal spacing from a 3 mm gap and 3 mm centered stroke', () => {
    expect(DEFAULT_IMPRENTA_2_PROFILE.minimumVisibleGapMm).toBe(3);
    expect(DEFAULT_IMPRENTA_2_PROFILE.laserCutOutlineWidthMm).toBe(3);
    expect(nominalClearance).toBe(
      DEFAULT_IMPRENTA_2_PROFILE.minimumVisibleGapMm! +
        DEFAULT_IMPRENTA_2_PROFILE.laserCutOutlineWidthMm!,
    );
    expect(6 - LASER_CUT_OUTLINE_WIDTH_MM).toBe(3);
  });
  it('measures diagonal segment distance, not bounding box separation', () => {
    const a = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ];
    const b = [
      { x: 10, y: 10 },
      { x: 10, y: 6 },
      { x: 6, y: 10 },
    ];
    expect(minimumContourDistance([a], [b])).toBeCloseTo(6 / Math.sqrt(2), 10);
    expect(contoursViolateClearance([a], [b], 3)).toBe(false);
  });
  it('allows a concave cavity with intersecting AABBs and rejects a near edge', () => {
    const l = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 30 },
      { x: 0, y: 30 },
    ];
    expect(minimumContourDistance([l], [move(rect(5, 5), 8, 8)])).toBe(3);
    expect(contoursViolateClearance([l], [move(rect(5, 5), 7.999, 8)], 3)).toBe(
      true,
    );
    expect(minimumContourDistance([l], [move(rect(2, 2), 1, 1)])).toBe(0);
  });
  it('checks nearby and distant islands independently without filling their envelope', () => {
    const islands = [rect(10, 10), move(rect(10, 10), 100)];
    expect(minimumContourDistance(islands, [move(rect(10, 10), 13)])).toBe(3);
    expect(
      contoursViolateClearance(islands, [move(rect(10, 10), 87.001)], 3),
    ).toBe(true);
    expect(minimumContourDistance(islands, [move(rect(10, 10), 40)])).toBe(30);
  });
  it('handles approximated curves and rotation without changing distances', () => {
    const circle = Array.from({ length: 64 }, (_, i) => ({
      x: 10 + 10 * Math.cos((i * Math.PI) / 32),
      y: 10 + 10 * Math.sin((i * Math.PI) / 32),
    }));
    expect(minimumContourDistance([circle], [move(circle, 23)])).toBeCloseTo(
      3,
      10,
    );
    const a = transformPolygon(rect(10, 20), { x: 0, y: 0, rotation: 90 });
    const b = transformPolygon(rect(10, 20), { x: 23, y: 0, rotation: -90 });
    expect(minimumContourDistance([a], [b])).toBe(3);
  });
});

function expectValid(
  result: ReturnType<typeof nestMultiplePieces>,
  minimum = 6,
  extent = 1.5,
) {
  for (const layout of result.layouts)
    for (const [i, p] of layout.pieces.entries()) {
      const contours = p.cutComponents ?? p.collisionComponents ?? [p.polygon];
      const bounds = getPolygonBounds(contours.flat());
      expect(bounds.minX).toBeGreaterThanOrEqual(extent - 1e-9);
      expect(bounds.minY).toBeGreaterThanOrEqual(extent - 1e-9);
      for (const q of layout.pieces.slice(i + 1))
        expect(
          minimumContourDistance(
            contours,
            q.cutComponents ?? q.collisionComponents ?? [q.polygon],
          ),
        ).toBeGreaterThanOrEqual(minimum - 1e-9);
    }
}

describe('productive nesting policy', () => {
  it('returns chunked fast batches as one complete multi-canvas result with global progress', () => {
    const canvas = nestingCanvasForProfile(DEFAULT_IMPRENTA_2_PROFILE);
    const polygon = rect(12, 10);
    const cutComponents = [polygon];
    const progress: { phase: string; completed?: number; total?: number }[] = [];
    const result = nestMultiplePieces({
      canvas,
      searchStrategy: 'fast',
      pieces: Array.from({ length: 201 }, (_, index) => ({
        id: `chunk-copy-${index}`,
        kind: 'garment' as const,
        polygon,
        finePolygon: polygon,
        cutComponents,
        cutAnchor: polygon,
        allowedRotations: [0, 90] as const,
      })),
    }, event => progress.push(event));

    expect(result.totalPieceCount).toBe(201);
    expect(result.placedCount).toBe(201);
    expect(result.unplacedPieceIds).toEqual([]);
    expect(result.layouts.length).toBeGreaterThan(1);
    expect(result.layouts.map(layout => layout.index)).toEqual(result.layouts.map((_, index) => index));
    expect(new Set(result.layouts.flatMap(layout => layout.pieces.map(piece => piece.pieceId))).size).toBe(201);
    expect(result.diagnostics?.uniqueGeometryCount).toBe(1);
    expect(result.diagnostics?.uniqueGeometryRotationVariants).toBe(2);
    expect(result.diagnostics?.geometryReferenceCacheHits).toBe(200);
    expect(result.diagnostics?.polygonTransforms).toBe(2);
    expect(result.diagnostics?.fastChunkRuns?.map(chunk => chunk.pieceCount)).toEqual([150, 51]);
    expect(progress.filter(event => event.phase === 'required').at(-1)).toMatchObject({
      phase: 'required',
      completed: 201,
      total: 201,
    });
    expectValid(result);
  });

  it('keeps a 150-piece fast batch in one nesting run', () => {
    const canvas = nestingCanvasForProfile(DEFAULT_IMPRENTA_2_PROFILE);
    const polygon = rect(12, 10);
    const result = nestMultiplePieces({
      canvas,
      searchStrategy: 'fast',
      pieces: Array.from({ length: 150 }, (_, index) => ({
        id: `single-run-copy-${index}`,
        kind: 'garment' as const,
        polygon,
        finePolygon: polygon,
        cutComponents: [polygon],
        cutAnchor: polygon,
        allowedRotations: [0, 90] as const,
      })),
    });

    expect(result.totalPieceCount).toBe(150);
    expect(result.placedCount).toBe(150);
    expect(result.unplacedPieceIds).toEqual([]);
    expect(result.diagnostics?.fastChunkRuns).toBeUndefined();
    expect(result.diagnostics?.fastChunkNestingElapsedMs).toBeUndefined();
    expectValid(result);
  });

  it.each(['fast', 'material'] as const)(
    'keeps Imprenta 2 geometry exact in the %s search strategy and caches repeated variants',
    searchStrategy => {
      const canvas = nestingCanvasForProfile(DEFAULT_IMPRENTA_2_PROFILE);
      const polygon = rect(82, 54);
      const cutComponents = [polygon];
      const pieces = Array.from({ length: 24 }, (_, i) => ({
        id: `copy-${i}`,
        kind: 'garment' as const,
        polygon,
        finePolygon: polygon,
        cutComponents,
        cutAnchor: polygon,
        allowedRotations: [0, 90] as const,
      }));
      const result = nestMultiplePieces({
        canvas,
        searchStrategy,
        pieces,
      });

      expect(DEFAULT_IMPRENTA_2_PROFILE.maxWidth).toBe(1560);
      expect(DEFAULT_IMPRENTA_2_PROFILE.maxHeight).toBe(5000);
      expect(canvas.minimumPieceClearance).toBe(6);
      expect(canvas.outlineExtentMm).toBe(1.5);
      expect(DEFAULT_IMPRENTA_2_PROFILE.laserCutOutlineWidthMm).toBe(3);
      expect(DEFAULT_IMPRENTA_2_PROFILE.minimumVisibleGapMm).toBe(3);
      expect(result.totalPieceCount).toBe(24);
      expect(result.placedCount).toBe(24);
      expect(result.unplacedPieceIds).toEqual([]);
      expect(result.diagnostics?.searchStrategy).toBe(searchStrategy);
      expect(result.diagnostics?.uniqueGeometryCount).toBe(1);
      expect(result.diagnostics?.uniqueGeometryRotationVariants).toBe(2);
      expect(result.diagnostics?.geometryReferenceCacheHits).toBe(23);
      expect(result.diagnostics?.polygonTransforms).toBe(2);
      expectValid(result);
      for (const layout of result.layouts) {
        for (const piece of layout.pieces) {
          expect([0, 90]).toContain(piece.placement.rotation);
          const bounds = getPolygonBounds(piece.cutComponents!.flat());
          expect(bounds.minX - 1.5).toBeGreaterThanOrEqual(-1e-9);
          expect(bounds.minY - 1.5).toBeGreaterThanOrEqual(-1e-9);
          expect(bounds.maxX + 1.5).toBeLessThanOrEqual(canvas.width + 1e-9);
          expect(bounds.maxY + 1.5).toBeLessThanOrEqual(canvas.height + 1e-9);
        }
      }
    },
  );

  it('keeps touching in both legacy profiles and separates identical input for laser', () => {
    const input: MultiNestingInput = {
      canvas: { width: 1480, height: 5000 },
      pieces: [0, 1].map((i) => ({
        id: String(i),
        kind: 'garment',
        polygon: rect(20, 20),
        allowedRotations: [0],
      })),
    };
    for (const height of [1000, 5000]) {
      const result = nestMultiplePieces({
        ...input,
        canvas: { width: 1480, height },
      });
      expect(
        minimumContourDistance(
          [result.layouts[0]!.pieces[0]!.polygon],
          [result.layouts[0]!.pieces[1]!.polygon],
        ),
      ).toBe(0);
    }
    const laser = nestMultiplePieces({
      ...input,
      canvas: nestingCanvasForProfile(DEFAULT_IMPRENTA_2_PROFILE),
    });
    expect(laser.placedCount).toBe(2);
    expect(laser.layouts).toHaveLength(1);
    expectValid(laser, 6, 1.5);
    expect(laser.layouts[0]!.pieces[0]!.placement.x).toBe(1.5);
    const profileCanvas = nestingCanvasForProfile(DEFAULT_IMPRENTA_2_PROFILE);
    expect(profileCanvas.width).toBeLessThanOrEqual(1560);
    expect(profileCanvas.height).toBeLessThanOrEqual(5000);
    expect(profileCanvas.outlineExtentMm).toBe(1.5);
    for (const layout of laser.layouts) {
      for (const piece of layout.pieces) {
        const bounds = getPolygonBounds(
          (piece.cutComponents ?? [piece.polygon]).flat(),
        );
        expect(bounds.maxX + profileCanvas.outlineExtentMm).toBeLessThanOrEqual(
          profileCanvas.width + 1e-9,
        );
        expect(bounds.maxY + profileCanvas.outlineExtentMm).toBeLessThanOrEqual(
          profileCanvas.height + 1e-9,
        );
      }
    }
  });
  it('retains multi-island rotations and checks every island', () => {
    const components = [rect(10, 10), move(rect(10, 10), 40, 20)];
    const result = nestMultiplePieces({
      canvas: {
        width: 150,
        height: 150,
        minimumPieceClearance: 6,
        outlineExtentMm: 1.5,
      },
      pieces: Array.from({ length: 8 }, (_, i) => ({
        id: String(i),
        kind: 'free-png',
        polygon: componentEnvelope(components),
        collisionComponents: components,
        allowedRotations: [0, 90, 180, -90],
      })),
    });
    expect(result.placedCount).toBe(8);
    expectValid(result);
  });
  it('keeps conservative personalized-back geometry and exact exterior cut islands separate', () => {
    const cut = [rect(20, 30), move(rect(5, 5), 30, 40)];
    const envelope = componentEnvelope(cut);
    const result = nestMultiplePieces({
      canvas: {
        width: 150,
        height: 150,
        minimumPieceClearance: 6,
        outlineExtentMm: 1.5,
      },
      pieces: Array.from({ length: 4 }, (_, i) => ({
        id: `nom-${i}`,
        kind: 'garment',
        polygon: envelope,
        finePolygon: envelope,
        cutComponents: cut,
        cutAnchor: envelope,
        allowedRotations: [0, 180],
      })),
    });
    expect(result.placedCount).toBe(4);
    expectValid(result);
    expect(
      result.layouts
        .flatMap((l) => l.pieces)
        .every((p) => p.cutComponents?.length === 2 && !p.collisionComponents),
    ).toBe(true);
  });
  it.each(['normal', 'max'] as const)(
    'fillers %s obey clearance without extending required height or adding layouts',
    (mode) => {
      const pieces = [
        {
          id: 'base-1',
          polygon: rect(60, 100),
          allowedRotations: [0] as const,
        },
        {
          id: 'logo-1',
          kind: 'free-png' as const,
          polygon: rect(10, 10),
          allowedRotations: [0] as const,
        },
      ];
      const input = {
        canvas: {
          width: 100,
          height: 200,
          minimumPieceClearance: 6,
          outlineExtentMm: 1.5,
        },
        pieces,
      };
      const required = nestMultiplePieces(input);
      const filled = nestMultiplePieces({
        ...input,
        fillers: [
          {
            definitionId: 'logo',
            requiredPieceId: 'logo-1',
            priority: 1,
            mode,
          },
        ],
      });
      expect(filled.extraCount).toBeGreaterThan(0);
      expect(filled.layouts).toHaveLength(required.layouts.length);
      expect(filled.layouts.map((l) => l.usedHeight)).toEqual(
        required.layouts.map((l) => l.usedHeight),
      );
      expectValid(filled);
    },
  );
  it('rejects a piece that fits nominally but cannot contain its complete stroke', () => {
    expect(
      nestMultiplePieces({
        canvas: {
          width: 20,
          height: 20,
          minimumPieceClearance: 6,
          outlineExtentMm: 1.5,
        },
        pieces: [
          { id: 'too-wide', polygon: rect(20, 20), allowedRotations: [0] },
        ],
      }).unplacedPieceIds,
    ).toEqual(['too-wide']);
  });
});
