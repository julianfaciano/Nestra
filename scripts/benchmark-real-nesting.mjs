import { createServer } from 'vite';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import process from 'node:process';

const inputPath = process.argv[2];

if (!inputPath) {
  console.error(
    'Uso: node scripts/benchmark-real-nesting.mjs <input.json>',
  );
  process.exit(1);
}

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
});

try {
  const { nestMultiplePieces } = await server.ssrLoadModule(
    '/src/geometry/multi-piece-nesting-engine.ts',
  );

  const input = JSON.parse(
    readFileSync(inputPath, 'utf8'),
  );

  const requestedStep = process.argv[3]
  ? Number(process.argv[3])
  : undefined;

if (
  requestedStep !== undefined &&
  (!Number.isFinite(requestedStep) || requestedStep <= 0)
) {
  throw new Error('scanStep inválido');
}

const benchmarkInput = {
  ...input,
  scanStepMm: requestedStep ?? input.scanStepMm ?? 10,
};

  const startedAt = performance.now();

const result = nestMultiplePieces({
  ...benchmarkInput,
  diagnosticProfiling: false,
});

  const elapsedMs = performance.now() - startedAt;

  const diagnostics = result.diagnostics ?? {};

  console.log('');
  console.log('===== NESTRA REAL NESTING — PROFILING OFF =====');
  console.log(`Input ..................... ${inputPath}`);
  console.log(`Piezas .................... ${input.pieces.length}`);
  console.log(
    `Canvas .................... ${input.canvas.width} x ${input.canvas.height} mm`,
  );
  console.log(
    `Scan step ................. ${benchmarkInput.scanStepMm} mm`,
  );
  console.log('');
  console.log(`Tiempo motor .............. ${elapsedMs.toFixed(2)} ms`);
  console.log(`Layouts ................... ${result.layouts.length}`);
  console.log(`Colocadas ................. ${result.placedCount}`);
  console.log(
    `Sin colocar ............... ${result.unplacedPieceIds.length}`,
  );
  console.log('');
  console.log(
    `Candidatos probados ....... ${diagnostics.candidatePlacementsTested ?? '—'}`,
  );
  console.log(
    `Cache hits ................ ${diagnostics.candidateCacheHits ?? '—'}`,
  );
  console.log(
    `Polygon transforms ........ ${diagnostics.polygonTransforms ?? '—'}`,
  );
  console.log(
    `Polygon translations ...... ${diagnostics.polygonTranslations ?? '—'}`,
  );
  console.log(
    `Broad-phase checks ........ ${diagnostics.broadPhaseChecks ?? '—'}`,
  );
  console.log(
    `Colisiones exactas ........ ${diagnostics.exactPolygonCollisionChecks ?? '—'}`,
  );
  console.log(
    `Layouts creados ........... ${diagnostics.layoutsCreated ?? '—'}`,
  );
  console.log('===============================================');
  console.log('');
} finally {
  await server.close();
}