// Bounded benchmark: actual order quantities and source dimensions, synthetic silhouettes.
// Does not import Library, modify sources, or claim to reproduce the real alpha nesting.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';

const output = process.env.NESTRA_PRODUCTION_BENCH_OUTPUT ?? 'docs/imprenta-2-production-benchmark.json';
const pieceLimit = Number(process.env.NESTRA_PRODUCTION_BENCH_PIECES ?? 0);
const profiling = process.env.NESTRA_PRODUCTION_BENCH_PROFILE === '1';
const searchStrategy = process.env.NESTRA_PRODUCTION_BENCH_STRATEGY ?? 'fast';
if (!['fast', 'material'].includes(searchStrategy)) throw new Error('Invalid search strategy');
if (isMainThread) {
  const limitMs = Number(process.argv[2] ?? 90000);
  if (!Number.isFinite(limitMs) || limitMs <= 0) throw new Error('Invalid benchmark limit');
  const worker = new Worker(new URL(import.meta.url));
  let started = performance.now(), latest = null, metadata = null, stopped = false;
  const progressSamples = [];
  const finish = async (status, result = null) => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    await worker.terminate();
    const report = { generatedAt: new Date().toISOString(), status, limitMs, elapsedMs: performance.now() - started, metadata, latestProgress: latest, progressSamples, result,
      limitation: 'Synthetic silhouettes with actual order quantities and audited source dimensions; not the real alpha contours. No export or Library import.' };
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
    if (status === 'error') process.exitCode = 1;
  };
  const timer = setTimeout(() => void finish('cancelled-time-limit'), limitMs);
  worker.on('message', message => {
    if (message.metadata) { metadata = message.metadata; console.log('READY ' + JSON.stringify(metadata)); }
    if (message.progress) {
      latest = message.progress;
      if (latest.phase !== 'required' || latest.completed % 100 === 0) {
        const sample = { ...latest, elapsedMs: performance.now() - started };
        progressSamples.push(sample);
        console.log('PROGRESS ' + JSON.stringify(sample));
      }
    }
    if (message.result) void finish('completed', message.result);
  });
  worker.on('error', error => void finish('error', { message: error.message }));
} else {
  const require = createRequire(import.meta.url), ts = require('typescript'), cache = new Map();
  function load(file) {
    const absolute = path.resolve(file);
    if (cache.has(absolute)) return cache.get(absolute);
    const mod = { exports: {} };
    cache.set(absolute, mod.exports);
    const js = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInThisContext('(function(require,module,exports){' + js + '\n})', { filename: absolute })(
      name => name.startsWith('.') ? load(path.resolve(path.dirname(absolute), name + '.ts')) : require(name), mod, mod.exports);
    cache.set(absolute, mod.exports);
    return mod.exports;
  }
  const audit = JSON.parse(fs.readFileSync('docs/asset-naming-audit.json', 'utf8'));
  const { parseOrderText, normalizeDesignName } = load('src/domain/order-import.ts');
  const { PRODUCTION_ORDER } = load('src/test/production-order-2026-10-01.ts');
  const preview = parseOrderText(PRODUCTION_ORDER, audit.designs.map(d => ({ id: d.path, name: d.name })));
  if (!preview.confirmable) throw new Error(preview.errors.join('\n'));
  const pieces = [];
  const logicalPieceTypeKeys = new Set();
  for (const line of preview.lines) {
    const design = audit.designs.find(d => normalizeDesignName(d.name) === normalizeDesignName(line.designName));
    for (const [size, quantity] of Object.entries(line.quantities)) for (const side of ['front', 'back']) {
      if (!quantity) continue;
      logicalPieceTypeKeys.add(JSON.stringify([design.path, size, side]));
      const file = design.pngs.find(f => !f.nom && f.canonical?.size === size && f.canonical.side === side);
      if (!file) throw new Error('Missing source: ' + design.name + ' ' + size + ' ' + side);
      const width = file.widthPx * 25.4 / 72, height = file.heightPx * 25.4 / 72;
      const polygon = [[.18, 0], [.82, 0], [1, .2], [.85, .35], [.85, 1], [.15, 1], [.15, .35], [0, .2]].map(([x, y]) => ({ x: x * width, y: y * height }));
      const cutComponents = [polygon];
      const allowedRotations = side === 'front' ? [0, 90, 180, -90] : [0, 180];
      for (let i = 0; i < quantity; i++) pieces.push({ id: design.name + '-' + size + '-' + side + '-' + i, kind: 'garment', polygon, finePolygon: polygon, cutComponents, cutAnchor: polygon, allowedRotations });
    }
  }
  const totalOrderPieces = pieces.length;
  if (pieceLimit > 0 && pieces.length > pieceLimit) pieces.length = pieceLimit;
  const geometryKey = piece => JSON.stringify([
    piece.polygon,
    piece.finePolygon,
    piece.collisionComponents,
    piece.cutComponents,
    piece.cutAnchor,
  ]);
  const uniqueGeometryKeys = new Set(pieces.map(geometryKey));
  const uniqueGeometryRotationKeys = new Set(pieces.flatMap(piece => piece.allowedRotations.map(rotation => `${geometryKey(piece)}|${rotation}`)));
  const { nestingCanvasForProfile, DEFAULT_IMPRENTA_2_PROFILE } = load('src/domain/canvas-profile.ts');
  const canvas = nestingCanvasForProfile(DEFAULT_IMPRENTA_2_PROFILE);
  parentPort.postMessage({ metadata: { dataset: 'Synthetic benchmark', searchStrategy, garments: preview.totalGarments, totalPieces: totalOrderPieces, logicalPieceTypes: logicalPieceTypeKeys.size, benchmarkPieces: pieces.length, syntheticGeometryTypes: uniqueGeometryKeys.size, syntheticGeometryRotationVariants: uniqueGeometryRotationKeys.size, profiles: 1, canvas, scanStepMm: 10, geometry: '8-vertex synthetic garment silhouettes' } });
  const result = load('src/geometry/multi-piece-nesting-engine.ts').nestMultiplePieces({ pieces, canvas, searchStrategy, scanStepMm: 10, diagnosticPhaseTiming: true, diagnosticProfiling: profiling, diagnosticRequiredScale: profiling && pieces.length <= 250 }, progress => parentPort.postMessage({ progress }));
  const d = result.diagnostics;
  const requiredPieceRanges = d?.requiredPieces?.length
    ? Array.from({ length: Math.ceil(d.requiredPieces.length / 25) }, (_, rangeIndex) => {
        const start = rangeIndex * 25;
        const entries = d.requiredPieces.slice(start, start + 25);
        return {
          pieceStart: start + 1,
          pieceEnd: start + entries.length,
          elapsedMs: entries.reduce((sum, piece) => sum + piece.elapsedMs, 0),
          maxPieceMs: Math.max(...entries.map(piece => piece.elapsedMs)),
          candidateOpportunities: entries.flatMap(piece => piece.attempts).reduce((sum, attempt) => sum + attempt.candidateOpportunitiesEmitted, 0),
          exactCollisionChecks: entries.flatMap(piece => piece.attempts).reduce((sum, attempt) => sum + attempt.exactCollisionChecks, 0),
        };
      })
    : undefined;
  parentPort.postMessage({ result: {
    piecesPlaced: result.placedCount,
    unplaced: result.unplacedPieceIds.length,
    canvases: result.layouts.length,
    usedHeights: result.layouts.map(layout => layout.usedHeight),
    totalUsedHeight: result.layouts.reduce((sum, layout) => sum + layout.usedHeight, 0),
    diagnostics: d ? {
      searchStrategy: d.searchStrategy,
      requiredCandidateBudget: d.requiredCandidateBudget,
      requiredCandidateBudgetStops: d.requiredCandidateBudgetStops,
      uniqueGeometries: d.uniqueGeometryCount,
      uniqueGeometryRotationVariants: d.uniqueGeometryRotationVariants,
      geometryReferenceCacheHits: d.geometryReferenceCacheHits,
      clearanceIndexedCalls: d.clearanceIndexedCalls,
      clearanceSegmentCandidates: d.clearanceSegmentCandidates,
      clearanceSegmentAabbChecks: d.clearanceSegmentAabbChecks,
      clearanceSegmentExactChecks: d.clearanceSegmentExactChecks,
      requiredMs: d.requiredMs,
      candidatePlacementsTested: d.candidatePlacementsTested,
      candidateCacheHits: d.candidateCacheHits,
      broadPhaseChecks: d.broadPhaseChecks,
      exactPolygonCollisionChecks: d.exactPolygonCollisionChecks,
      requiredFailedVersionHits: d.requiredFailedVersionHits,
      polygonTransforms: d.polygonTransforms,
      piecesUsingCollisionComponents: d.piecesUsingCollisionComponents,
      ...(requiredPieceRanges ? { requiredPieceRanges } : {}),
      ...(d.profile ? { profile: d.profile } : {}),
    } : null,
  } });
}
