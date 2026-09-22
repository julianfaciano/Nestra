import { expect, it } from 'vitest';
import { appendFileSync } from 'node:fs';
import { nestMultiplePieces, type MultiNestingInput } from './multi-piece-nesting-engine';
import { componentEnvelope } from './polygon-components';
import type { Polygon } from './polygon';

const enabled = process.env.NESTRA_PERF_AUDIT_BENCH === '1';
const bench = enabled ? it : it.skip;
const outputPath = process.env.NESTRA_PERF_AUDIT_OUTPUT;

const rect = (width: number, height: number): Polygon => [
  { x: 0, y: 0 },
  { x: width, y: 0 },
  { x: width, y: height },
  { x: 0, y: height },
];

const dense = (width: number, height: number, vertices = 160): Polygon =>
  Array.from({ length: vertices }, (_, i) => {
    const angle = (i * Math.PI * 2) / vertices;
    return {
      x: (width / 2) * (1 + Math.cos(angle)),
      y: (height / 2) * (1 + Math.sin(angle)),
    };
  });

function run(name: string, input: MultiNestingInput) {
  const started = performance.now();
  const result = nestMultiplePieces({
    ...input,
    diagnosticPhaseTiming: true,
    diagnosticProfiling: true,
  });
  const elapsedMs = performance.now() - started;
  const d = result.diagnostics!;
  const measurement = {
    name,
    elapsedMs,
    requiredMs: d.requiredMs,
    fillerMs: d.fillerMs,
    layouts: result.layouts.length,
    usedHeightMm: result.layouts.reduce((sum, layout) => sum + layout.usedHeight, 0),
    placed: result.placedCount,
    extras: result.extraCount,
    tested: d.candidatePlacementsTested,
    cacheHits: d.candidateCacheHits,
    translations: d.polygonTranslations,
    broad: d.broadPhaseChecks,
    exact: d.exactPolygonCollisionChecks,
    profile: d.profile,
  };
  console.info(`PERF_AUDIT ${JSON.stringify(measurement)}`);
  if (outputPath) appendFileSync(outputPath, `${JSON.stringify(measurement)}\n`);
  expect(result.unplacedPieceIds).toEqual([]);
  return result;
}

bench('free PNG simple repeated rectangles', () => {
  const polygon = rect(503, 153);
  run('free-png-simple', {
    canvas: { width: 1480, height: 1000 },
    scanStepMm: 10,
    pieces: Array.from({ length: 20 }, (_, i) => ({
      id: `simple-${i}`,
      kind: 'free-png' as const,
      polygon,
      collisionComponents: [polygon],
      allowedRotations: [0, 90, -90, 180] as const,
    })),
  });
});

bench('free PNG dense repeated contour', () => {
  const polygon = dense(503, 153);
  run('free-png-dense', {
    canvas: { width: 1480, height: 1000 },
    scanStepMm: 10,
    pieces: Array.from({ length: 10 }, (_, i) => ({
      id: `dense-${i}`,
      kind: 'free-png' as const,
      polygon,
      collisionComponents: [polygon],
      allowedRotations: [0, 90, -90, 180] as const,
    })),
  });
});

function fillerBase(mode: 'normal' | 'max'): MultiNestingInput {
  const filler = dense(20, 16, 64);
  return {
    canvas: { width: 240, height: 200 },
    scanStepMm: 10,
    pieces: [
      {
        id: 'base',
        polygon: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 120, y: 200 },
          { x: 0, y: 200 },
        ],
        allowedRotations: [0],
      },
      {
        id: 'a-1',
        kind: 'free-png',
        polygon: filler,
        collisionComponents: [filler],
        allowedRotations: [0],
      },
    ],
    fillers: [{ definitionId: 'a', requiredPieceId: 'a-1', priority: 1, mode }],
  };
}

bench('filler NORMAL', () => {
  run('filler-normal', fillerBase('normal'));
});

bench('filler MAX', () => {
  run('filler-max', fillerBase('max'));
});

bench('fillers MAX plus NORMAL', () => {
  const data = fillerBase('max');
  const normal = rect(10, 10);
  run('filler-mixed', {
    ...data,
    pieces: [
      ...data.pieces,
      {
        id: 'b-1',
        kind: 'free-png',
        polygon: normal,
        collisionComponents: [normal],
        allowedRotations: [0],
      },
    ],
    fillers: [
      ...data.fillers!,
      { definitionId: 'b', requiredPieceId: 'b-1', priority: 2, mode: 'normal' },
    ],
  });
});

bench('multi-island filler', () => {
  const islands = [
    rect(12, 12),
    rect(8, 8).map((point) => ({ x: point.x + 20, y: point.y + 4 })),
  ];
  const envelope = componentEnvelope(islands);
  run('filler-multi-island', {
    canvas: { width: 160, height: 120 },
    scanStepMm: 10,
    pieces: [
      { id: 'base', polygon: rect(80, 120), allowedRotations: [0] },
      {
        id: 'islands',
        kind: 'free-png',
        polygon: envelope,
        collisionComponents: islands,
        allowedRotations: [0, 180],
      },
    ],
    fillers: [{ definitionId: 'islands', requiredPieceId: 'islands', priority: 1, mode: 'max' }],
  });
});
