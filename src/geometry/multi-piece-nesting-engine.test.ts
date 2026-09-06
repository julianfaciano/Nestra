import { describe, expect, it } from 'vitest';
import { polygonFitsInsideCanvas } from './canvas-geometry';
import {
  nestMultiplePieces,
  type MultiNestingPiece,
} from './multi-piece-nesting-engine';
import type { Polygon } from './polygon';
import { polygonsOverlap } from './polygon-collision';

const square100: Polygon = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

const rectangle200x100: Polygon = [
  { x: 0, y: 0 },
  { x: 200, y: 0 },
  { x: 200, y: 100 },
  { x: 0, y: 100 },
];

function createSquare(id: string): MultiNestingPiece {
  return {
    id,
    polygon: square100,
    allowedRotations: [0, 90, 180, -90],
  };
}

describe('multi-piece nesting engine', () => {
  it('acomoda distintas piezas dentro del mismo canvas', () => {
    const result = nestMultiplePieces({
      pieces: [
        createSquare('a'),
        createSquare('b'),
        createSquare('c'),
        createSquare('d'),
      ],
      canvas: {
        width: 200,
        height: 200,
      },
      scanStepMm: 10,
    });

    expect(result.layouts).toHaveLength(1);
    expect(result.placedCount).toBe(4);
    expect(result.unplacedPieceIds).toHaveLength(0);
  });

  it('crea múltiples canvases cuando hace falta', () => {
    const result = nestMultiplePieces({
      pieces: [
        createSquare('a'),
        createSquare('b'),
        createSquare('c'),
        createSquare('d'),
        createSquare('e'),
      ],
      canvas: {
        width: 200,
        height: 200,
      },
      scanStepMm: 10,
    });

    expect(result.layouts).toHaveLength(2);
    expect(result.placedCount).toBe(5);
    expect(result.unplacedPieceIds).toHaveLength(0);
  });

  it('respeta las rotaciones particulares de cada pieza', () => {
    const piece: MultiNestingPiece = {
      id: 'rectangle',
      polygon: rectangle200x100,
      allowedRotations: [90],
    };

    const result = nestMultiplePieces({
      pieces: [piece],
      canvas: {
        width: 100,
        height: 200,
      },
      scanStepMm: 10,
    });

    expect(result.placedCount).toBe(1);

    expect(result.layouts[0]?.pieces[0]?.placement.rotation).toBe(90);
  });

  it('informa una pieza que no entra ni en un canvas vacío', () => {
    const huge: MultiNestingPiece = {
      id: 'huge',
      polygon: [
        { x: 0, y: 0 },
        { x: 500, y: 0 },
        { x: 500, y: 500 },
        { x: 0, y: 500 },
      ],
      allowedRotations: [0, 90],
    };

    const result = nestMultiplePieces({
      pieces: [huge],
      canvas: {
        width: 200,
        height: 200,
      },
      scanStepMm: 10,
    });

    expect(result.placedCount).toBe(0);
    expect(result.unplacedPieceIds).toEqual(['huge']);
    expect(result.layouts).toHaveLength(0);
  });

  it('nunca coloca piezas fuera del canvas', () => {
    const canvas = {
      width: 300,
      height: 200,
    };

    const result = nestMultiplePieces({
      pieces: [
        createSquare('a'),
        createSquare('b'),
        createSquare('c'),
        createSquare('d'),
        createSquare('e'),
      ],
      canvas,
      scanStepMm: 10,
    });

    for (const layout of result.layouts) {
      for (const piece of layout.pieces) {
        expect(polygonFitsInsideCanvas(piece.polygon, canvas)).toBe(true);
      }
    }
  });

  it('nunca superpone piezas del mismo layout', () => {
    const result = nestMultiplePieces({
      pieces: [
        createSquare('a'),
        createSquare('b'),
        createSquare('c'),
        createSquare('d'),
        createSquare('e'),
      ],
      canvas: {
        width: 300,
        height: 200,
      },
      scanStepMm: 10,
    });

    for (const layout of result.layouts) {
      for (
        let firstIndex = 0;
        firstIndex < layout.pieces.length;
        firstIndex += 1
      ) {
        for (
          let secondIndex = firstIndex + 1;
          secondIndex < layout.pieces.length;
          secondIndex += 1
        ) {
          const first = layout.pieces[firstIndex];
          const second = layout.pieces[secondIndex];

          if (!first || !second) {
            continue;
          }

          expect(polygonsOverlap(first.polygon, second.polygon)).toBe(false);
        }
      }
    }
  });
});
