import { expect, it } from 'vitest';
import { getBatchPieceLimitError } from './batch-page';

it('allows 1000 pieces across garments, replacements, and free PNGs', () => {
  expect(
    getBatchPieceLimitError([
      { kind: 'garment', quantity: 998 },
      { kind: 'replacement-piece', quantity: 1 },
      { kind: 'free-png', quantity: 1 },
    ]),
  ).toBeNull();
});

it('allows exactly 5000 pieces across garments, replacements, and free PNGs', () => {
  expect(
    getBatchPieceLimitError([
      { kind: 'garment', quantity: 4000 },
      { kind: 'replacement-piece', quantity: 750 },
      { kind: 'free-png', quantity: 250 },
    ]),
  ).toBeNull();
});

it('rejects 5001 pieces across garments, replacements, and free PNGs', () => {
  expect(
    getBatchPieceLimitError([
      { kind: 'garment', quantity: 4000 },
      { kind: 'replacement-piece', quantity: 750 },
      { kind: 'free-png', quantity: 251 },
    ]),
  ).toBe('Máximo 5000 piezas por batch en esta versión.');
});
