import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import baseline from './nesting-profiling-baseline.json';
import { profilingFixture } from './nesting-profiling-fixtures';
import { nestMultiplePieces } from './multi-piece-nesting-engine';
import { polygonsOverlap } from './polygon-collision';
import { polygonFitsInsideCanvas } from './canvas-geometry';

describe('temporary nesting profiler', () => {
  it.each(['squares', 'concave', 'dense'] as const)(
    'preserves the pre-instrumentation result exactly: %s',
    (kind) => {
      const input = profilingFixture(kind);
      const plain = nestMultiplePieces(input);

      const { diagnostics: _plainDiagnostics, ...plainResult } = plain;

      expect(
        createHash('sha256').update(JSON.stringify(plainResult)).digest('hex'),
      ).toBe(baseline[kind]);

      const measured = nestMultiplePieces({
        ...input,
        diagnosticProfiling: true,
      });

      const { profile, ...counts } = measured.diagnostics!;

      const repeated = nestMultiplePieces({
        ...input,
        diagnosticProfiling: true,
      });

      expect(repeated.layouts).toEqual(measured.layouts);
      expect(repeated.diagnostics!.profile!.counters).toEqual(
        profile!.counters,
      );

      const c = profile!.counters;

      expect(c.rejectionCacheLookups).toBe(
        counts.candidatePlacementsTested + counts.candidateCacheHits,
      );
      expect(c.rejectionCacheHits).toBe(counts.candidateCacheHits);
      expect(c.neighborCandidates).toBe(
        c.uniqueNeighbors + c.neighborDuplicates,
      );
      expect(c.segmentPairs).toBe(
        c.segmentAabbRejected + c.exactSegmentTests,
      );
      expect(c.collinearTests).toBeLessThanOrEqual(c.exactSegmentTests);
      expect(c.bucketLookups).toBe(c.cellKeys);
      expect(profile!.timings.polygonsOverlap.calls).toBe(
        counts.exactPolygonCollisionChecks,
      );
      expect(profile!.timings.candidatePolygon.calls).toBe(
        counts.polygonTranslations,
      );
      expect(profile!.timings.candidateCoordinates.calls).toBe(
        c.coordinateSets,
      );

      for (const timing of Object.values(profile!.timings)) {
        expect(timing.samples).toBeLessThanOrEqual(timing.calls);
        expect(timing.sampledMs).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(timing.estimatedMs)).toBe(true);
      }

      expect(
        profile!.unclassifiedMs +
          Object.values(profile!.timings).reduce(
            (n, t) => n + t.estimatedMs,
            0,
          ),
      ).toBeCloseTo(profile!.totalMs, 8);

      expect(JSON.parse(JSON.stringify(measured))).toEqual(measured);

      for (const layout of measured.layouts) {
        for (const [i, piece] of layout.pieces.entries()) {
          expect(
            polygonFitsInsideCanvas(piece.polygon, input.canvas),
          ).toBe(true);

          expect(
            input.pieces.find((p) => p.id === piece.pieceId)!
              .allowedRotations,
          ).toContain(piece.placement.rotation);

          for (const other of layout.pieces.slice(i + 1)) {
            expect(
              polygonsOverlap(piece.polygon, other.polygon),
            ).toBe(false);
          }
        }
      }
    },
    20_000,
  );

  it('serializes an empty profiled job with finite timings', () => {
    const result = nestMultiplePieces({
      pieces: [],
      canvas: { width: 100, height: 100 },
      diagnosticProfiling: true,
    });

    expect(result.diagnostics!.profile!.counters.coordinateSets).toBe(0);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});