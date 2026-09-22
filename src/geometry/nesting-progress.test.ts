import { expect, it } from 'vitest';
import {
  nestMultiplePieces,
  type MultiNestingInput,
  type NestingProgress,
} from './multi-piece-nesting-engine';

const square = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

it('reports bounded milestones without changing the nesting result', () => {
  const input: MultiNestingInput = {
    canvas: { width: 30, height: 10 },
    scanStepMm: 10,
    pieces: [
      {
        id: 'required-a',
        kind: 'garment',
        polygon: square,
        allowedRotations: [0],
      },
      {
        id: 'required-b',
        kind: 'free-png',
        polygon: square,
        allowedRotations: [0],
      },
    ],
    fillers: [
      {
        definitionId: 'filler-a',
        requiredPieceId: 'required-b',
        priority: 1,
        mode: 'max',
      },
    ],
  };
  const progress: NestingProgress[] = [];

  const instrumented = nestMultiplePieces(input, (event) => progress.push(event));
  const plain = nestMultiplePieces(input);

  expect(instrumented).toEqual(plain);
  expect(progress).toEqual([
    { phase: 'preparing' },
    { phase: 'required', completed: 1, total: 2 },
    { phase: 'required', completed: 2, total: 2 },
    { phase: 'fillers', completed: 1, total: 1 },
    { phase: 'finalizing' },
  ]);
});
