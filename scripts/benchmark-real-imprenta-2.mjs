// Bounded production benchmark over read-only real PNG contours.
// It never changes fixture quantities, source assets, or Library data.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';

const input = process.env.NESTRA_REAL_ASSET_GEOMETRY_INPUT;
const output = process.env.NESTRA_REAL_BENCH_OUTPUT ?? 'docs/imprenta-2-real-production-benchmark.json';
const pieceLimit = Number(process.env.NESTRA_REAL_BENCH_PIECES ?? 0);
const chunkSize = Number(process.env.NESTRA_REAL_BENCH_CHUNK_SIZE ?? 100);
if (isMainThread) {
  if (!input || !fs.existsSync(input)) throw new Error('Set NESTRA_REAL_ASSET_GEOMETRY_INPUT to the generated read-only geometry payload.');
  const limitMs = Number(process.argv[2] ?? 180000);
  if (!Number.isFinite(limitMs) || limitMs <= 0) throw new Error('Invalid benchmark limit');
  const worker = new Worker(new URL(import.meta.url), { workerData: path.resolve(input) });
  const started = performance.now();
  let latestProgress = null, metadata = null, stopped = false;
  const progressSamples = [];
  const finish = async (status, result = null) => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    await worker.terminate();
    const report = {
      generatedAt: new Date().toISOString(),
      status,
      limitMs,
      elapsedMs: performance.now() - started,
      metadata,
      latestProgress,
      progressSamples,
      result,
      limitation: 'Real PNG geometry preflight and nesting benchmark; no export or Library import.',
    };
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
    if (status === 'error') process.exitCode = 1;
  };
  const timer = setTimeout(() => void finish('cancelled-time-limit'), limitMs);
  worker.on('message', message => {
    if (message.metadata) {
      metadata = message.metadata;
      console.log('READY ' + JSON.stringify(metadata));
    }
    if (message.progress) {
      latestProgress = message.progress;
      if (latestProgress.phase !== 'required' || latestProgress.completed % 100 === 0) {
        const sample = { ...latestProgress, elapsedMs: performance.now() - started };
        progressSamples.push(sample);
        console.log('PROGRESS ' + JSON.stringify(sample));
      }
    }
    if (message.result) void finish('completed', message.result);
  });
  worker.on('error', error => void finish('error', { message: error.message }));
} else {
  const expectedRealPieces = Number(process.env.NESTRA_REAL_EXPECTED_PIECES ?? 1282);
  const require = createRequire(import.meta.url);
  const ts = require('typescript');
  const moduleCache = new Map();
  function load(file) {
    const absolute = path.resolve(file);
    if (moduleCache.has(absolute)) return moduleCache.get(absolute);
    const mod = { exports: {} };
    moduleCache.set(absolute, mod.exports);
    const source = fs.readFileSync(absolute, 'utf8');
    const js = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInThisContext(`(function(require,module,exports){${js}\n})`, { filename: absolute })(
      name => name.startsWith('.') ? load(path.resolve(path.dirname(absolute), `${name}.ts`)) : require(name),
      mod,
      mod.exports,
    );
    moduleCache.set(absolute, mod.exports);
    return mod.exports;
  }
  const data = JSON.parse(fs.readFileSync(workerData, 'utf8'));
  if (data.totalPieces !== expectedRealPieces || data.logicalPieceTypes !== 372 ||
      data.uniqueRealGeometries !== 217 || data.uniqueGeometryRotationVariants !== 608)
    throw new Error(`Real geometry payload count mismatch: ${JSON.stringify({
      totalPieces: data.totalPieces,
      logicalPieceTypes: data.logicalPieceTypes,
      uniqueRealGeometries: data.uniqueRealGeometries,
      uniqueGeometryRotationVariants: data.uniqueGeometryRotationVariants,
    })}`);
  const pieces = [];
  for (const type of data.logicalTypes) {
    const geometry = data.geometries[type.geometryIndex];
    if (!geometry) throw new Error(`Missing geometry ${type.geometryIndex}.`);
    for (let copy = 0; copy < type.quantity; copy++) pieces.push({
      id: `${type.id}-${copy + 1}`,
      kind: 'garment',
      polygon: geometry.fastPolygon,
      finePolygon: geometry.finePolygon,
      cutComponents: geometry.cutComponents,
      cutAnchor: geometry.cutAnchor,
      allowedRotations: type.allowedRotations,
    });
  }
  if (pieces.length !== expectedRealPieces) throw new Error(`Expected ${expectedRealPieces} physical copies, got ${pieces.length}.`);
  const totalPieces = pieces.length;
  if (pieceLimit > 0) pieces.length = Math.min(pieceLimit, pieces.length);
  const { nestingCanvasForProfile, DEFAULT_IMPRENTA_2_PROFILE } = load('src/domain/canvas-profile.ts');
  const canvas = nestingCanvasForProfile(DEFAULT_IMPRENTA_2_PROFILE);
  parentPort.postMessage({ metadata: {
    dataset: data.dataset,
    searchStrategy: 'fast',
    chunkSize,
    totalPieces: data.totalPieces,
    logicalPieceTypes: data.logicalPieceTypes,
    uniqueRealGeometries: data.uniqueRealGeometries,
    uniqueGeometryRotationVariants: data.uniqueGeometryRotationVariants,
    benchmarkPieces: pieces.length,
    expandedPieceCopies: pieces.length,
    canvas,
  } });
  const result = load('src/geometry/multi-piece-nesting-engine.ts').nestMultiplePieces({
    pieces,
    canvas,
    searchStrategy: 'fast',
    scanStepMm: 10,
    diagnosticPhaseTiming: true,
    diagnosticProfiling: true,
    diagnosticRequiredScale: pieces.length <= 100,
    diagnosticFastChunkSize: chunkSize,
  }, progress => parentPort.postMessage({ progress }));
  const diagnostics = result.diagnostics;
  const { contoursViolateClearance } = load('src/geometry/polygon-clearance.ts');
  const { getPolygonBounds } = load('src/geometry/polygon-transform.ts');
  const minimumClearance = canvas.minimumPieceClearance ?? 0;
  const outlineExtent = canvas.outlineExtentMm ?? 0;
  const allowedRotationsById = new Map(pieces.map(piece => [piece.id, piece.allowedRotations]));
  const expectedIds = new Set(pieces.map(piece => piece.id));
  const seenIds = new Set();
  let duplicateIds = 0, unexpectedIds = 0, invalidRotations = 0;
  let clippedPieces = 0, emptyContours = 0, exactClearanceChecks = 0;
  let clearanceViolations = 0, bboxPairsSkipped = 0, areaMm2 = 0;
  const canvasValidation = [];
  const materialHeights = [];
  const polygonArea = polygon => Math.abs(polygon.reduce((sum, point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2);
  for (const [layoutIndex, layout] of result.layouts.entries()) {
    if (layout.index !== layoutIndex) throw new Error(`Non-contiguous layout index ${layout.index} at ${layoutIndex}.`);
    const placed = [];
    let layoutMaxY = 0;
    for (const piece of layout.pieces) {
      if (seenIds.has(piece.pieceId)) duplicateIds++;
      seenIds.add(piece.pieceId);
      if (!expectedIds.has(piece.pieceId)) unexpectedIds++;
      const allowed = allowedRotationsById.get(piece.pieceId);
      if (!allowed?.includes(piece.placement.rotation)) invalidRotations++;
      const contours = piece.cutComponents;
      if (!contours?.length || contours.some(polygon => polygon.length < 3)) {
        emptyContours++;
        continue;
      }
      const bounds = getPolygonBounds(contours.flat());
      if (bounds.minX - outlineExtent < -1e-7 || bounds.minY - outlineExtent < -1e-7 ||
          bounds.maxX + outlineExtent > canvas.width + 1e-7 ||
          bounds.maxY + outlineExtent > canvas.height + 1e-7) clippedPieces++;
      layoutMaxY = Math.max(layoutMaxY, bounds.maxY + outlineExtent);
      areaMm2 += contours.reduce((sum, polygon) => sum + polygonArea(polygon), 0);
      placed.push({ contours, bounds });
    }
    materialHeights.push(layoutMaxY);
    for (let a = 0; a < placed.length; a++) {
      const first = placed[a];
      for (let b = a + 1; b < placed.length; b++) {
        const second = placed[b];
        const dx = Math.max(0, first.bounds.minX - second.bounds.maxX, second.bounds.minX - first.bounds.maxX);
        const dy = Math.max(0, first.bounds.minY - second.bounds.maxY, second.bounds.minY - first.bounds.maxY);
        if (Math.hypot(dx, dy) >= minimumClearance - 1e-9) {
          bboxPairsSkipped++;
          continue;
        }
        exactClearanceChecks++;
        if (contoursViolateClearance(first.contours, second.contours, minimumClearance)) clearanceViolations++;
      }
    }
    canvasValidation.push({
      canvasIndex: layoutIndex + 1,
      pieces: layout.pieces.length,
      nestingUsedHeightMm: layout.usedHeight,
      strokeInclusiveHeightMm: layoutMaxY,
    });
  }
  const missingIds = [...expectedIds].filter(id => !seenIds.has(id));
  const frontBackTotals = new Map();
  for (const type of data.logicalTypes) {
    const side = type.id.endsWith('-front') ? 'front' : type.id.endsWith('-back') ? 'back' : 'unknown';
    const key = side === 'unknown' ? type.id : type.id.slice(0, -(side.length + 1));
    const pair = frontBackTotals.get(key) ?? { front: 0, back: 0, unknown: 0 };
    if (side !== 'unknown') pair[side] += type.quantity;
    else pair.unknown++;
    frontBackTotals.set(key, pair);
  }
  const frontBackValid = frontBackTotals.size === 186 &&
    [...frontBackTotals.values()].every(pair => pair.front > 0 && pair.front === pair.back && pair.unknown === 0);
  const correctness = {
    passed: result.placedCount === totalPieces && result.unplacedPieceIds.length === 0 &&
      seenIds.size === totalPieces && duplicateIds === 0 && unexpectedIds === 0 && missingIds.length === 0 &&
      invalidRotations === 0 && clippedPieces === 0 && emptyContours === 0 && clearanceViolations === 0 && frontBackValid,
    expectedPieces: totalPieces,
    placedPieces: seenIds.size,
    duplicateIds,
    unexpectedIds,
    missingIds: missingIds.length,
    invalidRotations,
    clippedPieces,
    emptyContours,
    frontBackValid,
    logicalDesignSizePairs: frontBackTotals.size,
    exactClearanceChecks,
    bboxPairsSkipped,
    clearanceViolations,
    canvasWidthMm: canvas.width,
    canvasHeightMm: canvas.height,
    strokeExtentMm: outlineExtent,
    nominalClearanceMm: minimumClearance,
  };
  const chunks = (diagnostics?.fastChunkRuns ?? []).map(chunk => {
    const terminal = chunk.canvases.at(-1);
    return {
      ...chunk,
      closedCanvases: Math.max(0, chunk.canvases.length - 1),
      terminalCanvasPartial: Boolean(terminal && terminal.usedHeight + outlineExtent < canvas.height - 1e-6),
      terminalCanvas: terminal ? {
        pieces: terminal.pieceCount,
        nestingUsedHeightMm: terminal.usedHeight,
        remainingHeightBeforeStrokeMm: Math.max(0, canvas.height - terminal.usedHeight),
      } : null,
    };
  });
  const totalNestingUsedHeightMm = materialHeights.reduce((sum, height) => sum + height, 0);
  const totalNestingUsedMeters = totalNestingUsedHeightMm / 1000;
  const totalCanvasCapacityMm = canvas.width * materialHeights.length * canvas.height;
  const utilizedCanvasAreaPercent = totalCanvasCapacityMm > 0 ? areaMm2 / totalCanvasCapacityMm * 100 : 0;
  const materialAreaMm2 = canvas.width * totalNestingUsedHeightMm;
  const usedEnvelopeAreaPercent = materialAreaMm2 > 0 ? areaMm2 / materialAreaMm2 * 100 : 0;
  const partialCanvasWasteUpperBoundMm = chunks.reduce((sum, chunk) =>
    sum + (chunk.terminalCanvas ? Math.max(0, canvas.height - (chunk.terminalCanvas.nestingUsedHeightMm + outlineExtent)) : 0), 0);
  const requiredPieceRanges = diagnostics?.requiredPieces?.length
    ? Array.from({ length: Math.ceil(diagnostics.requiredPieces.length / 25) }, (_, index) => {
        const entries = diagnostics.requiredPieces.slice(index * 25, index * 25 + 25);
        const attempts = entries.flatMap(piece => piece.attempts);
        return {
          pieceStart: index * 25 + 1,
          pieceEnd: index * 25 + entries.length,
          elapsedMs: entries.reduce((sum, piece) => sum + piece.elapsedMs, 0),
          maxPieceMs: Math.max(...entries.map(piece => piece.elapsedMs)),
          candidateOpportunities: attempts.reduce((sum, attempt) => sum + attempt.candidateOpportunitiesEmitted, 0),
          broadPhaseChecks: attempts.reduce((sum, attempt) => sum + attempt.broadPhaseChecks, 0),
          exactCollisionChecks: attempts.reduce((sum, attempt) => sum + attempt.exactCollisionChecks, 0),
        };
      })
    : undefined;
  parentPort.postMessage({ result: {
    piecesPlaced: result.placedCount,
    totalPieces: result.totalPieceCount,
    totalOrderPieces: totalPieces,
    unplaced: result.unplacedPieceIds.length,
    canvases: result.layouts.length,
    usedHeights: result.layouts.map(layout => layout.usedHeight),
    totalUsedHeightMm: totalNestingUsedHeightMm,
    totalUsedMeters: totalNestingUsedMeters,
    canvasesDetail: canvasValidation,
    chunks,
    chunkPartialWasteUpperBoundMm: partialCanvasWasteUpperBoundMm,
    chunkPartialWasteUpperBoundMeters: partialCanvasWasteUpperBoundMm / 1000,
    occupiedAreaMm2: areaMm2,
    utilizedCanvasAreaPercent,
    usedEnvelopeAreaPercent,
    correctness,
    memoryApproxBytes: process.memoryUsage().heapUsed,
    diagnostics: diagnostics && {
      searchStrategy: diagnostics.searchStrategy,
      requiredCandidateBudget: diagnostics.requiredCandidateBudget,
      requiredCandidateBudgetStops: diagnostics.requiredCandidateBudgetStops,
      uniqueGeometries: diagnostics.uniqueGeometryCount,
      uniqueGeometryRotationVariants: diagnostics.uniqueGeometryRotationVariants,
      geometryReferenceCacheHits: diagnostics.geometryReferenceCacheHits,
      polygonTransforms: diagnostics.polygonTransforms,
      candidatePlacementsTested: diagnostics.candidatePlacementsTested,
      candidateCacheHits: diagnostics.candidateCacheHits,
      broadPhaseChecks: diagnostics.broadPhaseChecks,
      exactPolygonCollisionChecks: diagnostics.exactPolygonCollisionChecks,
      layoutsCreated: diagnostics.layoutsCreated,
      requiredMs: diagnostics.requiredMs,
      fastChunkNestingElapsedMs: diagnostics.fastChunkNestingElapsedMs,
      fastChunkRuns: diagnostics.fastChunkRuns,
      requiredCandidateBudgetStops: diagnostics.requiredCandidateBudgetStops,
      clearanceIndexedCalls: diagnostics.clearanceIndexedCalls,
      clearanceSegmentCandidates: diagnostics.clearanceSegmentCandidates,
      clearanceSegmentAabbChecks: diagnostics.clearanceSegmentAabbChecks,
      clearanceSegmentExactChecks: diagnostics.clearanceSegmentExactChecks,
      profile: diagnostics.profile,
      ...(requiredPieceRanges ? { requiredPieceRanges } : {}),
    },
  } });
}
