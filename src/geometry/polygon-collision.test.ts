import { describe, expect, it } from 'vitest';
import type { Polygon } from './polygon';
import { polygonsOverlap } from './polygon-collision';
import {
  getPolygonBounds,
  polygonPixelsToMillimeters,
  transformPolygon,
} from './polygon-transform';
import { polygonFitsInsideCanvas } from './canvas-geometry';

const square: Polygon = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

describe('geometría de colocación', () => {
  it('detecta dos polígonos superpuestos', () => {
    const first = transformPolygon(square, {
      x: 0,
      y: 0,
      rotation: 0,
    });

    const second = transformPolygon(square, {
      x: 50,
      y: 50,
      rotation: 0,
    });

    expect(polygonsOverlap(first, second)).toBe(true);
  });

  it('permite que dos piezas se toquen sin superponerse', () => {
    const first = transformPolygon(square, {
      x: 0,
      y: 0,
      rotation: 0,
    });

    const second = transformPolygon(square, {
      x: 100,
      y: 0,
      rotation: 0,
    });

    expect(polygonsOverlap(first, second)).toBe(false);
  });

  it('detecta piezas separadas', () => {
    const first = transformPolygon(square, {
      x: 0,
      y: 0,
      rotation: 0,
    });

    const second = transformPolygon(square, {
      x: 150,
      y: 0,
      rotation: 0,
    });

    expect(polygonsOverlap(first, second)).toBe(false);
  });

  it('detecta una pieza contenida completamente dentro de otra', () => {
    const large: Polygon = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 200 },
      { x: 0, y: 200 },
    ];

    const small: Polygon = [
      { x: 50, y: 50 },
      { x: 100, y: 50 },
      { x: 100, y: 100 },
      { x: 50, y: 100 },
    ];

    expect(polygonsOverlap(large, small)).toBe(true);
  });

  it('comprueba que una pieza entra dentro del canvas', () => {
    const placed = transformPolygon(square, {
      x: 400,
      y: 500,
      rotation: 0,
    });

    expect(
      polygonFitsInsideCanvas(placed, {
        width: 1480,
        height: 1000,
      }),
    ).toBe(true);
  });

  it('detecta una pieza que sale del canvas', () => {
    const placed = transformPolygon(square, {
      x: 1400,
      y: 500,
      rotation: 0,
    });

    expect(
      polygonFitsInsideCanvas(placed, {
        width: 1480,
        height: 1000,
      }),
    ).toBe(false);
  });

  it('convierte polígonos raster a milímetros', () => {
    const rasterPolygon: Polygon = [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 500 },
      { x: 0, y: 500 },
    ];

    const physical = polygonPixelsToMillimeters(
      rasterPolygon,
      1000,
      500,
      400,
      200,
    );

    expect(physical[1]).toEqual({
      x: 400,
      y: 0,
    });

    expect(physical[2]).toEqual({
      x: 400,
      y: 200,
    });
  });

  it('rota una pieza 90 grados manteniendo origen utilizable', () => {
    const rectangle: Polygon = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
      { x: 0, y: 100 },
    ];

    const placed = transformPolygon(rectangle, {
      x: 10,
      y: 20,
      rotation: 90,
    });

    expect(
      polygonFitsInsideCanvas(placed, {
        width: 120,
        height: 230,
      }),
    ).toBe(true);
  });
  it('detecta superposición con bordes colineales', () => {
    const first: Polygon = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];

    const second: Polygon = [
      { x: 0, y: 50 },
      { x: 100, y: 50 },
      { x: 100, y: 150 },
      { x: 0, y: 150 },
    ];

    expect(polygonsOverlap(first, second)).toBe(true);
  });
});

it('preserves the bounds-aware collision path, including empty polygons', () => {
  const first = transformPolygon(square, { x: 0, y: 0, rotation: 0 });
  for (const x of [0, 0.01, 99.99, 100, 100.01, 200]) {
    const second = transformPolygon(square, { x, y: 0, rotation: 180 });
    expect(
      polygonsOverlap(
        first,
        second,
        getPolygonBounds(first),
        getPolygonBounds(second),
      ),
    ).toBe(polygonsOverlap(first, second));
  }
  expect(polygonsOverlap([], first)).toBe(false);
  expect(polygonsOverlap(first, [])).toBe(false);
});
