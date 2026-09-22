import { describe, expect, it, vi } from 'vitest';
import type { Polygon } from './polygon';
import { polygonsOverlap, createIndexedPolygonOverlap } from './polygon-collision';
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

it('indexed filler collision matches the reference for touching, overlap, containment and concavity', () => {
  const indexed = createIndexedPolygonOverlap();
  const concave: Polygon = [{x:0,y:0},{x:100,y:0},{x:100,y:20},{x:20,y:20},{x:20,y:100},{x:0,y:100}];
  for (const source of [square,concave]) for (const rotation of [0,90,-90,180] as const) {
    for (const x of [0,10,20,99.999,100,100.001]) for (const y of [0,20,100]) {
      const moved=transformPolygon(source,{x,y,rotation});
      expect(indexed(moved,concave)).toBe(polygonsOverlap(moved,concave));
      expect(indexed(concave,moved)).toBe(polygonsOverlap(concave,moved));
    }
  }
});

it('keeps indexed collision identical across dense, decimal, collinear and containment cases', () => {
  const indexed = createIndexedPolygonOverlap();
  const dense = (cx: number, cy: number, rx: number, ry: number): Polygon =>
    Array.from({ length: 96 }, (_, i) => {
      const angle = i * Math.PI * 2 / 96;
      return { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) };
    });
  const concave: Polygon = [
    {x: 0.1, y: 0.2}, {x: 100.1, y: 0.2}, {x: 100.1, y: 20.2},
    {x: 20.1, y: 20.2}, {x: 20.1, y: 100.2}, {x: 0.1, y: 100.2},
  ];
  const cases: Polygon[] = [
    square,
    concave,
    dense(50, 50, 50, 50),
    dense(50.000001, 50.000001, 49.999, 49.999),
    [{x: 0, y: 0}, {x: 100, y: 0}, {x: 100, y: 0}, {x: 0, y: 100}],
  ];
  for (const first of cases) for (const second of cases) {
    expect(indexed(first, second)).toBe(polygonsOverlap(first, second));
    expect(indexed(second, first)).toBe(polygonsOverlap(second, first));
  }
});

it('reduces deterministic bounds work by more than fivefold on dense contours', () => {
  const ring=(x:number,y:number):Polygon=>Array.from({length:300},(_,i)=>({
    x:x+5*Math.cos(i*Math.PI/150),y:y+5*Math.sin(i*Math.PI/150)}));
  const a=ring(0,0),b=ring(8,8);
  const min=vi.spyOn(Math,'min');
  try {
    const expected=polygonsOverlap(a,b);
    const previous=min.mock.calls.length;
    min.mockClear();
    const result=createIndexedPolygonOverlap()(a,b);
    const current=min.mock.calls.length;
    expect(result).toBe(expected);
    expect(current).toBeLessThan(previous/5);
  } finally {min.mockRestore();}
});

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
