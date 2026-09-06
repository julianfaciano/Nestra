import { createServer } from 'vite';
import { performance } from 'node:perf_hooks';
import process from 'node:process';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
});
try {
  const { nestMultiplePieces } = await server.ssrLoadModule(
    '/src/geometry/multi-piece-nesting-engine.ts',
  );
  const { polygonsOverlap } = await server.ssrLoadModule(
    '/src/geometry/polygon-collision.ts',
  );
  const { polygonFitsInsideCanvas } = await server.ssrLoadModule(
    '/src/geometry/canvas-geometry.ts',
  );
  const fixtures = {
    squares: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ],
    textileSynthetic: [
      { x: 80, y: 0 },
      { x: 240, y: 0 },
      { x: 340, y: 100 },
      { x: 280, y: 180 },
      { x: 260, y: 620 },
      { x: 60, y: 620 },
      { x: 40, y: 180 },
      { x: 0, y: 100 },
    ],
  };
  for (const [name, polygon] of Object.entries(fixtures)) {
    const pieces = Array.from({ length: 582 }, (_, i) => ({
      id: String(i),
      polygon: polygon.map((p) => ({ ...p })),
      allowedRotations: i % 2 ? [0, 180] : [0, 90, -90, 180],
    }));
    const start = performance.now();
    const result = nestMultiplePieces({
      pieces,
      canvas: { width: 1480, height: 5000 },
      scanStepMm: 10,
    });
    const elapsedMs = performance.now() - start;
    // Independent exhaustive verification, outside the measured nesting time.
    for (const layout of result.layouts) {
      for (const [i, piece] of layout.pieces.entries()) {
        if (
          !polygonFitsInsideCanvas(piece.polygon, { width: 1480, height: 5000 })
        )
          throw new Error('Outside canvas');
        for (const other of layout.pieces.slice(i + 1)) {
          if (polygonsOverlap(piece.polygon, other.polygon))
            throw new Error('Overlap');
        }
      }
    }
    const oldGridCandidates =
      name === 'squares'
        ? pieces.reduce(
            (sum, piece, i) =>
              sum +
              (Math.floor(i / 14) * 10 * 149 + (i % 14) * 10) *
                piece.allowedRotations.length +
              1,
            0,
          )
        : undefined;
    process.stdout.write(
      JSON.stringify(
        {
          name,
          elapsedMs,
          exactSafetyVerified: true,
          oldGridCandidates,
          layouts: result.layouts.length,
          unplaced: result.unplacedPieceIds.length,
          diagnostics: result.diagnostics,
        },
        null,
        2,
      ) + '\n',
    );
  }
} finally {
  await server.close();
}
