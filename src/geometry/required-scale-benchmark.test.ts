import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import {
  nestMultiplePieces,
  type MultiNestingInput,
  type RequiredLayoutAttemptDiagnostics,
  type RequiredPieceDiagnostics,
} from './multi-piece-nesting-engine';
import type { Polygon } from './polygon';

const enabled = process.env.NESTRA_REQUIRED_BENCH === '1';
const bench = enabled ? it : it.skip;
const singleSize = Number(process.env.NESTRA_REQUIRED_BENCH_SINGLE ?? 0);
const singleHeight = Number(process.env.NESTRA_REQUIRED_BENCH_HEIGHT ?? 5000);
const singleProfiling = process.env.NESTRA_REQUIRED_BENCH_PROFILE === '1';
const outputPath = process.env.NESTRA_REQUIRED_BENCH_OUTPUT;

function panel(width: number, height: number, back: boolean): Polygon {
  if (back) {
    return [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: width * 0.78, y: height },
      { x: width * 0.72, y: height * 0.84 },
      { x: width * 0.28, y: height * 0.84 },
      { x: width * 0.22, y: height },
      { x: 0, y: height },
    ];
  }
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height * 0.72 },
    { x: width * 0.84, y: height },
    { x: width * 0.16, y: height },
    { x: 0, y: height * 0.72 },
  ];
}

function requiredPieces(count: number): MultiNestingInput['pieces'] {
  const garments = Math.ceil(count / 2);
  const pieces: MultiNestingInput['pieces'][number][] = [];
  for (let garment = 0; garment < garments; garment++) {
    const size = garment % 13;
    const frontWidth = 270 + size * 7;
    const frontHeight = 360 + size * 8;
    const backWidth = 265 + size * 7;
    const backHeight = 355 + size * 8;
    pieces.push({
      id: `g${garment}-front`,
      kind: 'garment',
      polygon: panel(frontWidth, frontHeight, false),
      allowedRotations: [0, 90, -90, 180],
    });
    if (pieces.length < count) {
      pieces.push({
        id: `g${garment}-back`,
        kind: 'garment',
        polygon: panel(backWidth, backHeight, true),
        allowedRotations: [0, 180],
      });
    }
  }
  return pieces;
}

function input(count: number, height = 5000, profiling = false): MultiNestingInput {
  return {
    pieces: requiredPieces(count),
    canvas: { width: 1480, height },
    scanStepMm: 10,
    diagnosticPhaseTiming: true,
    diagnosticRequiredScale: true,
    ...(profiling ? { diagnosticProfiling: true } : {}),
  };
}

function sumAttempts(
  pieces: readonly RequiredPieceDiagnostics[],
  select: (attempt: RequiredLayoutAttemptDiagnostics) => number,
): number {
  let total = 0;
  for (const piece of pieces) for (const attempt of piece.attempts) total += select(attempt);
  return total;
}

function summarize(count: number, height = 5000, profiling = false) {
  const result = nestMultiplePieces(input(count, height, profiling));
  const diagnostics = result.diagnostics!;
  const pieces = diagnostics.requiredPieces!;
  const potential = sumAttempts(pieces, (a) => a.candidateOpportunitiesPotential);
  const emitted = sumAttempts(pieces, (a) => a.candidateOpportunitiesEmitted);
  const prunedBeforeTranslation = sumAttempts(pieces, (a) => a.candidatesPrunedBeforeTranslation);
  const contactChecks = sumAttempts(pieces, (a) => a.contactChecks);
  const failedLayoutMs = pieces.reduce(
    (total, piece) => total + piece.attempts
      .filter((attempt) => !attempt.success && attempt.piecesInLayout > 0)
      .reduce((sum, attempt) => sum + attempt.elapsedMs, 0),
    0,
  );
  return {
    count,
    result,
    summary: {
      pieces: count,
      timeMs: diagnostics.requiredMs,
      timePerPieceMs: diagnostics.requiredMs / count,
      layouts: result.layouts.length,
      usedHeightMm: result.layouts.reduce((sum, layout) => sum + layout.usedHeight, 0),
      candidateOpportunitiesPotential: potential,
      candidateOpportunities: emitted,
      candidateOpportunitiesPerPiece: emitted / count,
      prunedBeforeTranslation,
      failedVersionHits: diagnostics.requiredFailedVersionHits,
      cacheHits: diagnostics.candidateCacheHits,
      tested: diagnostics.candidatePlacementsTested,
      translations: diagnostics.polygonTranslations,
      broad: diagnostics.broadPhaseChecks,
      exact: diagnostics.exactPolygonCollisionChecks,
      contactChecks,
      failedLayoutMs,
      failedLayoutPct: diagnostics.requiredMs ? failedLayoutMs / diagnostics.requiredMs * 100 : 0,
    },
  };
}

function latePiece(piece: RequiredPieceDiagnostics) {
  return {
    piece: piece.pieceIndex,
    timeMs: piece.elapsedMs,
    layoutsTried: piece.layoutsTried,
    maxX: Math.max(0, ...piece.attempts.map((a) => a.xCoordinatesUnique)),
    maxY: Math.max(0, ...piece.attempts.map((a) => a.yCoordinatesUnique)),
    variants: Math.max(0, ...piece.attempts.map((a) => a.variantsConsidered)),
    potential: piece.attempts.reduce((sum, a) => sum + a.candidateOpportunitiesPotential, 0),
    emitted: piece.attempts.reduce((sum, a) => sum + a.candidateOpportunitiesEmitted, 0),
    cacheHits: piece.attempts.reduce((sum, a) => sum + a.candidateCacheHits, 0),
    prunedBeforeTranslation: piece.attempts.reduce((sum, a) => sum + a.candidatesPrunedBeforeTranslation, 0),
    translations: piece.attempts.reduce((sum, a) => sum + a.candidatesTranslated, 0),
    exact: piece.attempts.reduce((sum, a) => sum + a.exactCollisionChecks, 0),
    contactChecks: piece.attempts.reduce((sum, a) => sum + a.contactChecks, 0),
  };
}

function rangeSummary(pieces: readonly RequiredPieceDiagnostics[], from: number, to: number) {
  const slice = pieces.slice(from - 1, to);
  return {
    range: `${from}-${to}`,
    timeMs: slice.reduce((sum, piece) => sum + piece.elapsedMs, 0),
    layoutsTried: slice.reduce((sum, piece) => sum + piece.layoutsTried, 0),
    emitted: sumAttempts(slice, (a) => a.candidateOpportunitiesEmitted),
    cacheHits: sumAttempts(slice, (a) => a.candidateCacheHits),
    translations: sumAttempts(slice, (a) => a.candidatesTranslated),
    broad: sumAttempts(slice, (a) => a.broadPhaseChecks),
    exact: sumAttempts(slice, (a) => a.exactCollisionChecks),
    contactChecks: sumAttempts(slice, (a) => a.contactChecks),
  };
}

function layoutSummaries(pieces: readonly RequiredPieceDiagnostics[]) {
  const byLayout = new Map<number, RequiredLayoutAttemptDiagnostics[]>();
  for (const piece of pieces) for (const attempt of piece.attempts) {
    const attempts = byLayout.get(attempt.layoutIndex) ?? [];
    attempts.push(attempt);
    byLayout.set(attempt.layoutIndex, attempts);
  }
  return [...byLayout.entries()].map(([layoutIndex, attempts]) => {
    const emitted = attempts.reduce((sum, a) => sum + a.candidateOpportunitiesEmitted, 0);
    const cacheHits = attempts.reduce((sum, a) => sum + a.candidateCacheHits, 0);
    return {
      layoutIndex,
      attempts: attempts.length,
      successes: attempts.filter((a) => a.success).length,
      maxPiecesInLayout: Math.max(...attempts.map((a) => a.piecesInLayout)),
      timeMs: attempts.reduce((sum, a) => sum + a.elapsedMs, 0),
      failedMs: attempts.filter((a) => !a.success).reduce((sum, a) => sum + a.elapsedMs, 0),
      potential: attempts.reduce((sum, a) => sum + a.candidateOpportunitiesPotential, 0),
      emitted,
      cacheHits,
      cacheHitPct: emitted ? cacheHits / emitted * 100 : 0,
      tested: attempts.reduce((sum, a) => sum + a.candidateCacheLookups - a.candidateCacheHits, 0),
      maxX: Math.max(...attempts.map((a) => a.xCoordinatesUnique)),
      maxY: Math.max(...attempts.map((a) => a.yCoordinatesUnique)),
      maxVariants: Math.max(...attempts.map((a) => a.variantsConsidered)),
    };
  });
}

function failedLayoutSummary(pieces: readonly RequiredPieceDiagnostics[]) {
  const failed = pieces.flatMap((piece) => piece.attempts)
    .filter((attempt) => !attempt.success && attempt.piecesInLayout > 0);
  const potential = failed.reduce((sum, a) => sum + a.candidateOpportunitiesPotential, 0);
  const emitted = failed.reduce((sum, a) => sum + a.candidateOpportunitiesEmitted, 0);
  const cacheLookups = failed.reduce((sum, a) => sum + a.candidateCacheLookups, 0);
  const cacheHits = failed.reduce((sum, a) => sum + a.candidateCacheHits, 0);
  const tested = cacheLookups - cacheHits;
  return {
    attempts: failed.length,
    elapsedMs: failed.reduce((sum, a) => sum + a.elapsedMs, 0),
    potential,
    rejectedByCheapBoundsBeforeLookup: potential - emitted,
    emitted,
    cacheLookups,
    cacheHits,
    tested,
    translated: failed.reduce((sum, a) => sum + a.candidatesTranslated, 0),
    broad: failed.reduce((sum, a) => sum + a.broadPhaseChecks, 0),
    exact: failed.reduce((sum, a) => sum + a.exactCollisionChecks, 0),
    exhaustedWithoutFreshTests: failed.filter((a) => a.candidateCacheLookups === a.candidateCacheHits).length,
    reachedExactCollision: failed.filter((a) => a.exactCollisionChecks > 0).length,
  };
}

function exactRepeatedFailedVersionSummary(
  count: number,
  pieces: readonly RequiredPieceDiagnostics[],
) {
  const sourceById = new Map(requiredPieces(count).map((piece) => [piece.id, piece] as const));
  const geometryKeyById = new Map([...sourceById].map(([id, piece]) => [
    id,
    JSON.stringify([
      piece.kind,
      piece.allowedRotations,
      piece.polygon.map((point) => [point.x, point.y]),
      piece.finePolygon?.map((point) => [point.x, point.y]),
      piece.collisionComponents?.map((component) => component.map((point) => [point.x, point.y])),
    ]),
  ] as const));
  const failedVersions = new Set<string>();
  const repeated: RequiredLayoutAttemptDiagnostics[] = [];

  for (const piece of pieces) {
    const geometryKey = geometryKeyById.get(piece.pieceId);
    if (!geometryKey) throw new Error(`Missing source geometry for ${piece.pieceId}`);
    for (const attempt of piece.attempts) {
      if (attempt.success || attempt.piecesInLayout === 0) continue;
      const versionKey = `${geometryKey}|${attempt.layoutIndex}|${attempt.piecesInLayout}`;
      if (failedVersions.has(versionKey)) repeated.push(attempt);
      else failedVersions.add(versionKey);
    }
  }

  const potential = repeated.reduce((sum, a) => sum + a.candidateOpportunitiesPotential, 0);
  const emitted = repeated.reduce((sum, a) => sum + a.candidateOpportunitiesEmitted, 0);
  const cacheLookups = repeated.reduce((sum, a) => sum + a.candidateCacheLookups, 0);
  const cacheHits = repeated.reduce((sum, a) => sum + a.candidateCacheHits, 0);
  return {
    attempts: repeated.length,
    elapsedMs: repeated.reduce((sum, a) => sum + a.elapsedMs, 0),
    potential,
    emitted,
    cacheLookups,
    cacheHits,
    tested: cacheLookups - cacheHits,
    translated: repeated.reduce((sum, a) => sum + a.candidatesTranslated, 0),
    broad: repeated.reduce((sum, a) => sum + a.broadPhaseChecks, 0),
    exact: repeated.reduce((sum, a) => sum + a.exactCollisionChecks, 0),
  };
}

describe('REQUIRED garment scale benchmark', () => {
  bench('measures Calandra scale, late pieces, cache revisits and 1000 vs 5000 mm', () => {
    if (singleSize > 0) {
      const run = summarize(singleSize, singleHeight, singleProfiling);
      console.info(`REQUIRED_SCALE_SINGLE ${JSON.stringify(run.summary)}`);
      console.info(`REQUIRED_SCALE_LAYOUTS ${JSON.stringify(layoutSummaries(run.result.diagnostics!.requiredPieces!))}`);
      console.info(`REQUIRED_SCALE_FAILED ${JSON.stringify(failedLayoutSummary(run.result.diagnostics!.requiredPieces!))}`);
      console.info(`REQUIRED_SCALE_EXACT_REPEAT ${JSON.stringify(exactRepeatedFailedVersionSummary(singleSize, run.result.diagnostics!.requiredPieces!))}`);
      if (singleProfiling) {
        console.info(`REQUIRED_SCALE_PROFILE ${JSON.stringify(run.result.diagnostics!.profile)}`);
      }
      if (outputPath) writeFileSync(outputPath, JSON.stringify({
        summary: run.summary,
        failedLayouts: failedLayoutSummary(run.result.diagnostics!.requiredPieces!),
        ...(run.result.diagnostics!.profile ? { profile: run.result.diagnostics!.profile } : {}),
        result: {
          layouts: run.result.layouts,
          placedCount: run.result.placedCount,
          unplacedPieceIds: run.result.unplacedPieceIds,
          extraCount: run.result.extraCount,
        },
      }));
      expect(run.result.unplacedPieceIds).toEqual([]);
      return;
    }

    const plain50 = nestMultiplePieces({
      pieces: requiredPieces(50),
      canvas: { width: 1480, height: 5000 },
      scanStepMm: 10,
    });
    const sizes = [50, 100, 200, 300, 400, 520] as const;
    const runs = sizes.map((size) => summarize(size, 5000, false));
    const run50 = runs[0]!;
    expect(run50.result.layouts).toEqual(plain50.layouts);
    expect(run50.result.unplacedPieceIds).toEqual(plain50.unplacedPieceIds);

    const full = runs[runs.length - 1]!;
    expect(full.result.unplacedPieceIds).toEqual([]);
    const required = full.result.diagnostics!.requiredPieces!;
    const profiled520 = summarize(520, 5000, true);

    // Same geometry/piece set; only the canvas height changes.
    const imprenta200 = summarize(200, 1000, false);
    const calandra200 = runs.find((run) => run.summary.pieces === 200)!;

    const profile = profiled520.result.diagnostics!.profile!;
    console.info(`REQUIRED_SCALE_BENCHMARK ${JSON.stringify({
      scale: runs.map((run) => run.summary),
      ranges: [
        rangeSummary(required, 1, 50),
        rangeSummary(required, 51, 100),
        rangeSummary(required, 101, 200),
        rangeSummary(required, 201, 300),
        rangeSummary(required, 301, 400),
        rangeSummary(required, 401, 520),
      ],
      latePieces: [50, 100, 200, 300, 400, 500].map((index) => latePiece(required[index - 1]!)),
      canvasHeightComparison200: {
        calandra5000: calandra200.summary,
        imprenta1000: imprenta200.summary,
      },
      profiled520: {
        summary: profiled520.summary,
        timings: profile.timings,
        unclassifiedMs: profile.unclassifiedMs,
        totalMs: profile.totalMs,
      },
    })}`);
  }, 1_200_000);
});
