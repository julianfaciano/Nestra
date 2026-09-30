import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { nestMultiplePieces, type MultiNestingInput, type MultiNestingPiece } from './multi-piece-nesting-engine';
import type { Polygon } from './polygon';
import { componentEnvelope } from './polygon-components';

const enabled = process.env.NESTRA_REPLACEMENT_BENCH === '1';
const bench = enabled ? it : it.skip;

function shape(index: number): Polygon {
  return Array.from({ length: 10 }, (_, vertex) => {
    const angle = vertex * Math.PI * 2 / 10;
    const radius = 0.83 + 0.12 * Math.sin(angle * 3 + index * 0.19);
    return { x: (1 + Math.cos(angle) * radius) * (90 + index % 4 * 3), y: (1 + Math.sin(angle) * radius) * (130 + Math.floor(index / 4) * 2) };
  });
}

function pieces(asFreePng: boolean): MultiNestingPiece[] {
  return Array.from({ length: 24 }, (_, index) => {
    const polygon = shape(index);
    const side = index % 2 === 0 ? 'front' : 'back';
    return {
      id: `${asFreePng ? 'png' : 'replacement'}-${index}`,
      kind: asFreePng ? 'free-png' : 'garment',
      polygon: asFreePng ? componentEnvelope([polygon]) : polygon,
      ... (asFreePng ? { collisionComponents: [polygon] } : {}),
      allowedRotations: asFreePng || side === 'front' ? [0, 90, -90, 180] : [0, 180],
    };
  });
}

function run(pieces: MultiNestingPiece[]) {
  const input: MultiNestingInput = {
    pieces,
    canvas: { width: 1480, height: 1000 },
    scanStepMm: 22.5,
    diagnosticProfiling: true,
    diagnosticPhaseTiming: true,
    diagnosticRequiredScale: true,
  };
  const startedAt = performance.now();
  const result = nestMultiplePieces(input);
  const elapsedMs = performance.now() - startedAt;
  const d = result.diagnostics!;
  const candidateCacheLookups = d.requiredPieces!.flatMap(piece => piece.attempts).reduce((sum, attempt) => sum + attempt.candidateCacheLookups, 0);
  const hash = createHash('sha256').update(JSON.stringify({ layouts: result.layouts, unplaced: result.unplacedPieceIds })).digest('hex');
  return {
    elapsedMs,
    requiredMs: d.requiredMs,
    candidates: d.candidatePlacementsTested,
    cacheHits: d.candidateCacheHits,
    cacheLookups: candidateCacheLookups,
    cacheHitPct: candidateCacheLookups ? d.candidateCacheHits * 100 / candidateCacheLookups : 0,
    transforms: d.polygonTransforms,
    translations: d.polygonTranslations,
    broad: d.broadPhaseChecks,
    exact: d.exactPolygonCollisionChecks,
    componentOverlapCalls: d.componentsOverlapCalls,
    componentPairCandidates: d.componentPairCandidates,
    componentPairAabbRejects: d.componentPairAabbRejects,
    componentPairBoundsRecomputed: d.componentPairBoundsRecomputed,
    componentPairExactChecks: d.componentPairExactChecks,
    layouts: result.layouts.length,
    usedHeight: result.layouts.map(layout => layout.usedHeight),
    hash,
  };
}

bench('compares library replacement garment path with equivalent free-PNG collision path', () => {
  const replacementTrials = Array.from({ length: 3 }, () => run(pieces(false)));
  const pngTrials = Array.from({ length: 3 }, () => run(pieces(true)));
  const median = (values: readonly number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
  const replacement = { ...replacementTrials[0]!, requiredMsMedian: median(replacementTrials.map(trial => trial.requiredMs)), elapsedMsMedian: median(replacementTrials.map(trial => trial.elapsedMs)) };
  const png = { ...pngTrials[0]!, requiredMsMedian: median(pngTrials.map(trial => trial.requiredMs)), elapsedMsMedian: median(pngTrials.map(trial => trial.elapsedMs)) };
  console.info(`REPLACEMENT_REQUIRED_BENCH ${JSON.stringify({ replacementTrials, freePngTrials: pngTrials, replacementMedian: replacement, freePngMedian: png })}`);
  expect(replacement.componentOverlapCalls).toBe(0);
  expect(replacement.componentPairExactChecks).toBe(0);
  expect(png.componentOverlapCalls).toBeGreaterThan(0);
  expect(png.componentPairExactChecks).toBeGreaterThan(0);
  expect(replacement.candidates).toBeGreaterThan(0);
  expect(png.candidates).toBeGreaterThan(0);
}, 60_000);
