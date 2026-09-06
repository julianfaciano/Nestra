import type { MultiNestingInput } from './multi-piece-nesting-engine';

// Synthetic regression inputs, not the user's real 96-piece batch.
export function profilingFixture(
  kind: 'squares' | 'concave' | 'dense',
): MultiNestingInput {
  const polygon =
    kind === 'squares'
      ? [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ]
      : kind === 'concave'
        ? [
            { x: 0, y: 0 },
            { x: 310.5, y: 0 },
            { x: 310.5, y: 110 },
            { x: 100, y: 110 },
            { x: 100, y: 430.5 },
            { x: 0, y: 430.5 },
          ]
        : Array.from({ length: 96 }, (_, i) => {
            const angle = (i * Math.PI * 2) / 96;
            const radius = 1 + 0.15 * Math.cos(angle * 5);
            return {
              x: 170 + Math.cos(angle) * 150 * radius,
              y: 220 + Math.sin(angle) * 190 * radius,
            };
          });
  return {
    canvas: { width: 1480, height: kind === 'squares' ? 5000 : 1000 },
    scanStepMm: 10,
    pieces: Array.from(
      { length: kind === 'squares' ? 582 : kind === 'concave' ? 40 : 96 },
      (_, i) => ({
        id: String(i),
        polygon: polygon.map((p) => ({ ...p })),
        allowedRotations: i % 2 ? [0, 180] : [0, 90, -90, 180],
      }),
    ),
  };
}
