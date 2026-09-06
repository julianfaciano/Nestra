import { describe, expect, it } from 'vitest';
import type { Polygon } from './polygon';
import { nestSinglePolygon } from './nesting-engine';
import { polygonsOverlap } from './polygon-collision';
import { polygonFitsInsideCanvas } from './canvas-geometry';

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

describe('nesting engine MVP', () => {
  it('acomoda cuatro cuadrados en un canvas de 200 x 200', () => {
    const result = nestSinglePolygon({
      polygon: square100,
      quantity: 4,
      allowedRotations: [0],
      canvas: {
        width: 200,
        height: 200,
      },
      scanStepMm: 10,
    });

    expect(result.placed).toHaveLength(4);
    expect(result.unplacedCount).toBe(0);
  });

  it('informa piezas que no entran', () => {
    const result = nestSinglePolygon({
      polygon: square100,
      quantity: 5,
      allowedRotations: [0],
      canvas: {
        width: 200,
        height: 200,
      },
      scanStepMm: 10,
    });

    expect(result.placed).toHaveLength(4);
    expect(result.unplacedCount).toBe(1);
  });

  it('nunca coloca una pieza fuera del canvas', () => {
    const canvas = {
      width: 300,
      height: 200,
    };

    const result = nestSinglePolygon({
      polygon: square100,
      quantity: 6,
      allowedRotations: [0],
      canvas,
      scanStepMm: 10,
    });

    for (const piece of result.placed) {
      expect(polygonFitsInsideCanvas(piece.polygon, canvas)).toBe(true);
    }
  });

  it('nunca superpone las piezas colocadas', () => {
    const result = nestSinglePolygon({
      polygon: square100,
      quantity: 6,
      allowedRotations: [0],
      canvas: {
        width: 300,
        height: 200,
      },
      scanStepMm: 10,
    });

    for (
      let firstIndex = 0;
      firstIndex < result.placed.length;
      firstIndex += 1
    ) {
      for (
        let secondIndex = firstIndex + 1;
        secondIndex < result.placed.length;
        secondIndex += 1
      ) {
        const first = result.placed[firstIndex];
        const second = result.placed[secondIndex];

        if (!first || !second) {
          continue;
        }

        expect(polygonsOverlap(first.polygon, second.polygon)).toBe(false);
      }
    }
  });

  it('puede aprovechar una rotación permitida', () => {
    const result = nestSinglePolygon({
      polygon: rectangle200x100,
      quantity: 1,
      allowedRotations: [90],
      canvas: {
        width: 100,
        height: 200,
      },
      scanStepMm: 10,
    });

    expect(result.placed).toHaveLength(1);
    expect(result.placed[0]?.placement.rotation).toBe(90);
  });

  it('devuelve resultado vacío para cantidad cero', () => {
    const result = nestSinglePolygon({
      polygon: square100,
      quantity: 0,
      allowedRotations: [0],
      canvas: {
        width: 200,
        height: 200,
      },
    });

    expect(result.placed).toHaveLength(0);
    expect(result.unplacedCount).toBe(0);
    expect(result.usedWidth).toBe(0);
    expect(result.usedHeight).toBe(0);
  });
});
