import { createServer } from 'vite';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { deepStrictEqual } from 'node:assert';
import process from 'node:process';
import console from 'node:console';

// Optional argument: JSON MultiNestingInput for ONE fabric, already prepared in mm.
const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
});
try {
  const { nestMultiplePieces } = await server.ssrLoadModule(
    '/src/geometry/multi-piece-nesting-engine.ts',
  );
  const { profilingFixture } = await server.ssrLoadModule(
    '/src/geometry/nesting-profiling-fixtures.ts',
  );
  const input = process.argv[2]
    ? JSON.parse(readFileSync(process.argv[2], 'utf8'))
    : profilingFixture('dense');
  const times = { off: [], on: [] };
  let profile;
  const plain = nestMultiplePieces({ ...input, diagnosticProfiling: false });
  nestMultiplePieces({ ...input, diagnosticProfiling: true }); // warm both paths
  for (let round = 0; round < 6; round++) {
    for (const enabled of round % 2 ? [true, false] : [false, true]) {
      const start = performance.now();
      const result = nestMultiplePieces({
        ...input,
        diagnosticProfiling: enabled,
      });
      times[enabled ? 'on' : 'off'].push(performance.now() - start);
      const { profile: measuredProfile, ...counters } = result.diagnostics;
      deepStrictEqual({ ...result, diagnostics: counters }, plain);
      if (measuredProfile) profile = measuredProfile;
    }
  }
  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return (sorted[2] + sorted[3]) / 2;
  };
  const offMs = median(times.off),
    onMs = median(times.on);
  console.log(
    JSON.stringify(
      {
        fixture: process.argv[2] ?? 'SYNTHETIC dense 96 pieces / 96 vertices',
        runtime: process.version,
        exactResultsVerified: true,
        times,
        offMs,
        onMs,
        overheadPercent: (onMs / offMs - 1) * 100,
        profile,
      },
      null,
      2,
    ),
  );
} finally {
  await server.close();
}
