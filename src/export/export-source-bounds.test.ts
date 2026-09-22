import { describe, expect, it } from 'vitest';
import { DEFAULT_CALANDRA_PROFILE, DEFAULT_IMPRENTA_PROFILE } from '../domain/canvas-profile';
import type { BatchPieceDefinition } from '../domain/production-batch';
import { mm } from '../domain/units';
import { extractAlphaPixelBounds } from '../geometry/alpha-polygon';
import type { Polygon } from '../geometry/polygon';
import { transformPolygon, type PolygonPlacement } from '../geometry/polygon-transform';
import { nativePngPlan } from './native-png-export';
import { PX_PER_MM, preflightBatch, type PreparedBatch } from './export-plan';

const ONE_SOURCE_PX_MM = 25.4 / 72;

const rect = (x: number, y: number, width: number, height: number): Polygon => [
  { x, y },
  { x: x + width, y },
  { x: x + width, y: y + height },
  { x, y: y + height },
];

function definition(id: string, width = 20, height = 20): BatchPieceDefinition {
  return {
    kind: 'free-png',
    id,
    fabric: 'set',
    quantity: 1,
    fileName: `${id}.png`,
    imageUrl: `blob:${id}`,
    sourceWidthPx: width,
    sourceHeightPx: height,
    physicalWidthMm: mm(width),
    physicalHeightMm: mm(height),
    alphaThreshold: 16,
    simplificationTolerancePx: 1.5,
  };
}

function definitionAt72Ppi(id: string, width = 1, height = 1): BatchPieceDefinition {
  return {
    ...definition(id, width, height),
    physicalWidthMm: mm(width * ONE_SOURCE_PX_MM),
    physicalHeightMm: mm(height * ONE_SOURCE_PX_MM),
  };
}

function batch(
  definitions: readonly BatchPieceDefinition[],
  polygons: ReadonlyMap<string, Polygon>,
  bounds: ReadonlyMap<string, { x: number; y: number; width: number; height: number }>,
  layouts: readonly (readonly { id: string; placement: PolygonPlacement }[])[],
  calandra = false,
  sourcePlacementBounds?: ReadonlyMap<
    string,
    { x: number; y: number; width: number; height: number }
  >,
): PreparedBatch {
  return {
    definitions,
    polygons,
    collisionPolygons: polygons,
    sourceAlphaBounds: bounds,
    ...(sourcePlacementBounds ? { sourcePlacementBounds } : {}),
    profile: calandra ? DEFAULT_CALANDRA_PROFILE : DEFAULT_IMPRENTA_PROFILE,
    results: [{
      fabric: 'set',
      elapsedMs: 0,
      unplacedPieceIds: [],
      layouts: layouts.map((pieces, index) => ({
        index,
        usedWidth: Math.max(...pieces.map(({ id, placement }) => {
          const polygon = polygons.get(id)!;
          const transformed = transformPolygon(polygon, placement);
          return Math.max(...transformed.map((point) => point.x));
        })),
        usedHeight: Math.max(...pieces.map(({ id, placement }) => {
          const polygon = polygons.get(id)!;
          const transformed = transformPolygon(polygon, placement);
          return Math.max(...transformed.map((point) => point.y));
        })),
        pieces: pieces.map(({ id, placement }) => ({
          pieceId: `${id}-1`,
          placement,
          polygon: transformPolygon(polygons.get(id)!, placement),
        })),
      })),
    }],
  };
}

describe('límites alpha del plan de exportación', () => {
  it.each([
    { rotation: 0 as const, x: 100, y: 200 },
    { rotation: 90 as const, x: 103, y: 200 },
    { rotation: -90 as const, x: 100, y: 204 },
    { rotation: 180 as const, x: 104, y: 203 },
  ])('mantiene el origen físico de un crop asimétrico a $rotation°', ({ rotation, x, y }) => {
    const a = definition('rotation', 10, 8);
    const report = preflightBatch(batch(
      [a],
      new Map([['rotation', rect(1, 2, 4, 3)]]),
      new Map([['rotation', { x: 1, y: 2, width: 4, height: 3 }]]),
      [[{ id: 'rotation', placement: { x: 100, y: 200, rotation } }]],
      false,
      new Map([['rotation', { x: 1, y: 2, width: 4, height: 3 }]]),
    ));
    expect(report.errors).toEqual([]);
    const plan = nativePngPlan(report.layouts[0]!, new Map([['rotation', 0]]));
    expect(plan.pieces[0]!.translateX / PX_PER_MM).toBeCloseTo(x, 9);
    expect(plan.pieces[0]!.translateY / PX_PER_MM).toBeCloseTo(y, 9);
    expect(plan.pieces[0]!.width / PX_PER_MM).toBeCloseTo(4, 9);
    expect(plan.pieces[0]!.height / PX_PER_MM).toBeCloseTo(3, 9);
  });

  it('A — admite margen transparente izquierdo con tinta en x=0', () => {
    const a = definition('a');
    const input = batch(
      [a],
      new Map([['a', rect(10, 0, 10, 20)]]),
      new Map([['a', { x: 10, y: 0, width: 10, height: 20 }]]),
      [[{ id: 'a', placement: { x: 0, y: 0, rotation: 0 } }]],
    );
    const report = preflightBatch(input);
    expect(report.errors).toEqual([]);
    expect(report.layouts[0]).toMatchObject({ widthMm: 1480, offsetX: 0 });
    expect(report.layouts[0]!.pieces[0]!.sourceCrop).toMatchObject({ xPx: 10, widthPx: 10 });
  });

  it('B — combina margen izquierdo y pieza visible en x=1480 sin ensanchar', () => {
    const a = definition('a');
    const b = definition('b');
    const input = batch(
      [a, b],
      new Map([
        ['a', rect(10, 0, 10, 20)],
        ['b', rect(0, 0, 10, 20)],
      ]),
      new Map([
        ['a', { x: 10, y: 0, width: 10, height: 20 }],
        ['b', { x: 0, y: 0, width: 10, height: 20 }],
      ]),
      [[
        { id: 'a', placement: { x: 0, y: 0, rotation: 0 } },
        { id: 'b', placement: { x: 1470, y: 0, rotation: 0 } },
      ]],
    );
    const report = preflightBatch(input);
    expect(report.errors).toEqual([]);
    expect(report.layouts[0]).toMatchObject({ widthMm: 1480, offsetX: 0 });
    const plan = nativePngPlan(report.layouts[0]!, new Map([['a', 0], ['b', 1]]));
    expect(plan.pieces).toMatchObject([
      { source: 0, translateX: 0, width: 10 * 300 / 25.4 },
      { source: 1, translateX: 1470 * 300 / 25.4, width: 10 * 300 / 25.4 },
    ]);
  });

  it('C — recorta márgenes transparentes a ambos lados de una fuente', () => {
    const a = definition('a', 30, 20);
    const report = preflightBatch(batch(
      [a],
      new Map([['a', rect(10, 0, 10, 20)]]),
      new Map([['a', { x: 10, y: 0, width: 10, height: 20 }]]),
      [[{ id: 'a', placement: { x: 700, y: 0, rotation: 90 } }]],
    ));
    expect(report.errors).toEqual([]);
    expect(report.layouts[0]!.pieces[0]!.sourceCrop).toMatchObject({ xPx: 10, widthPx: 10 });
    const plan = nativePngPlan(report.layouts[0]!, new Map([['a', 0]]));
    expect(plan.pieces[0]).toMatchObject({
      translateX: 720 * 300 / 25.4,
      translateY: 0,
      width: 10 * 300 / 25.4,
      height: 20 * 300 / 25.4,
      rotation: 90,
    });
  });

  it('D — recorta transparencia vertical en y=0 y y=5000', () => {
    const top = definition('top', 20, 30);
    const bottom = definition('bottom', 20, 30);
    const report = preflightBatch(batch(
      [top, bottom],
      new Map([
        ['top', rect(0, 10, 10, 10)],
        ['bottom', rect(0, 0, 10, 10)],
      ]),
      new Map([
        ['top', { x: 0, y: 10, width: 10, height: 10 }],
        ['bottom', { x: 0, y: 0, width: 10, height: 10 }],
      ]),
      [[
        { id: 'top', placement: { x: 0, y: 0, rotation: 0 } },
        { id: 'bottom', placement: { x: 20, y: 4990, rotation: 0 } },
      ]],
      true,
    ));
    expect(report.errors).toEqual([]);
    expect(report.layouts[0]).toMatchObject({ heightMm: 5000, offsetY: 0 });
  });

  it('E — calcula offsets independientes para múltiples canvas', () => {
    const left = definition('left');
    const right = definition('right');
    const report = preflightBatch(batch(
      [left, right],
      new Map([
        ['left', rect(10, 0, 10, 20)],
        ['right', rect(0, 0, 10, 20)],
      ]),
      new Map([
        ['left', { x: 5, y: 0, width: 15, height: 20 }],
        ['right', { x: 0, y: 0, width: 15, height: 20 }],
      ]),
      [
        [{ id: 'left', placement: { x: 0, y: 0, rotation: 0 } }],
        [{ id: 'right', placement: { x: 1470, y: 0, rotation: 0 } }],
      ],
    ));
    expect(report.errors).toEqual([]);
    expect(report.layouts.map((layout) => layout.offsetX)).toEqual([-5, 5]);
    expect(report.layouts.every((layout) => layout.widthMm === 1480)).toBe(true);
  });

  it('F — incluye una isla opaca separada y bloquea si no cabe', () => {
    const pixels = new Uint8ClampedArray(20 * 10 * 4);
    pixels[(1 * 20 + 0) * 4 + 3] = 255;
    pixels[(8 * 20 + 19) * 4 + 3] = 255;
    expect(extractAlphaPixelBounds({ width: 20, height: 10, data: pixels })).toEqual({
      x: 0,
      y: 1,
      width: 20,
      height: 8,
    });

    const label = definition('label');
    const edge = definition('edge');
    const report = preflightBatch(batch(
      [label, edge],
      new Map([
        ['label', rect(10, 0, 10, 10)],
        ['edge', rect(0, 0, 10, 10)],
      ]),
      new Map([
        ['label', { x: 0, y: 0, width: 20, height: 10 }],
        ['edge', { x: 0, y: 0, width: 10, height: 10 }],
      ]),
      [[
        { id: 'label', placement: { x: 0, y: 0, rotation: 0 } },
        { id: 'edge', placement: { x: 1470, y: 0, rotation: 0 } },
      ]],
    ));
    expect(report.errors.join('\n')).toContain('contenido visible excede');
  });

  it('acepta contenido visible exactamente en x=1480 y rechaza 1 px físico real de overflow', () => {
    const anchor = definitionAt72Ppi('anchor-x');
    const edge = definitionAt72Ppi('edge-x');
    const polygons = new Map<string, Polygon>([
      ['anchor-x', rect(0, 0, ONE_SOURCE_PX_MM, ONE_SOURCE_PX_MM)],
      ['edge-x', rect(0, 0, ONE_SOURCE_PX_MM, ONE_SOURCE_PX_MM)],
    ]);
    const bounds = new Map([
      ['anchor-x', { x: 0, y: 0, width: 1, height: 1 }],
      ['edge-x', { x: 0, y: 0, width: 1, height: 1 }],
    ]);
    const exact = preflightBatch(batch(
      [anchor, edge],
      polygons,
      bounds,
      [[
        { id: 'anchor-x', placement: { x: 0, y: 0, rotation: 0 } },
        { id: 'edge-x', placement: { x: 1480 - ONE_SOURCE_PX_MM, y: 10, rotation: 0 } },
      ]],
    ));
    expect(exact.errors).toEqual([]);

    const overflow = preflightBatch(batch(
      [anchor, edge],
      polygons,
      bounds,
      [[
        { id: 'anchor-x', placement: { x: 0, y: 0, rotation: 0 } },
        { id: 'edge-x', placement: { x: 1480, y: 10, rotation: 0 } },
      ]],
    ));
    const issue = overflow.boundsIssues.find((item) => item.definitionId === 'edge-x');
    expect(issue).toMatchObject({
      canvasIndex: 1,
      instanceId: 'edge-x-1',
      definitionId: 'edge-x',
      sourceDimensionsPx: { width: 1, height: 1 },
      sourceAlphaBoundsPx: { x: 0, y: 0, width: 1, height: 1 },
    });
    expect(issue!.overflowMm.right).toBeCloseTo(ONE_SOURCE_PX_MM, 9);
    expect(issue!.message).toMatch(/Canvas 1 · edge-x\.png: .*borde derecho/);
    expect(issue!.message).toContain('0,353 mm');
  });

  it('no convierte en overflow el píxel que sólo perdió la simplificación del contorno', () => {
    const simplified = definitionAt72Ppi('arg24-t8-back', 1245, 1796);
    const edge = definitionAt72Ppi('right-edge');
    const polygons = new Map<string, Polygon>([
      [
        'arg24-t8-back',
        rect(
          ONE_SOURCE_PX_MM,
          0,
          1244 * ONE_SOURCE_PX_MM,
          1796 * ONE_SOURCE_PX_MM,
        ),
      ],
      ['right-edge', rect(0, 0, ONE_SOURCE_PX_MM, ONE_SOURCE_PX_MM)],
    ]);
    const alphaBounds = new Map([
      ['arg24-t8-back', { x: 0, y: 0, width: 1245, height: 1796 }],
      ['right-edge', { x: 0, y: 0, width: 1, height: 1 }],
    ]);
    const placementBounds = new Map([
      ['arg24-t8-back', { x: 0, y: 0, width: 1245, height: 1796 }],
      ['right-edge', { x: 0, y: 0, width: 1, height: 1 }],
    ]);

    const report = preflightBatch(batch(
      [simplified, edge],
      polygons,
      alphaBounds,
      [[
        { id: 'arg24-t8-back', placement: { x: 0, y: 0, rotation: 0 } },
        {
          id: 'right-edge',
          placement: {
            x: 1480 - ONE_SOURCE_PX_MM,
            y: 10,
            rotation: 0,
          },
        },
      ]],
      false,
      placementBounds,
    ));

    expect(report.errors).toEqual([]);
    expect(report.layouts[0]).toMatchObject({ widthMm: 1480, offsetX: 0 });
    expect(report.layouts[0]!.pieces[0]).toMatchObject({
      translateX: 0,
      translateY: 0,
    });
  });

  it('sigue rechazando 1 px visible real fuera del contorno crudo de colocación', () => {
    const body = definitionAt72Ppi('body-with-island', 4, 4);
    const edge = definitionAt72Ppi('right-edge-real');
    const polygons = new Map<string, Polygon>([
      [
        'body-with-island',
        rect(
          ONE_SOURCE_PX_MM,
          0,
          3 * ONE_SOURCE_PX_MM,
          4 * ONE_SOURCE_PX_MM,
        ),
      ],
      ['right-edge-real', rect(0, 0, ONE_SOURCE_PX_MM, ONE_SOURCE_PX_MM)],
    ]);
    const alphaBounds = new Map([
      ['body-with-island', { x: 0, y: 0, width: 4, height: 4 }],
      ['right-edge-real', { x: 0, y: 0, width: 1, height: 1 }],
    ]);
    const placementBounds = new Map([
      ['body-with-island', { x: 1, y: 0, width: 3, height: 4 }],
      ['right-edge-real', { x: 0, y: 0, width: 1, height: 1 }],
    ]);

    const report = preflightBatch(batch(
      [body, edge],
      polygons,
      alphaBounds,
      [[
        { id: 'body-with-island', placement: { x: 0, y: 0, rotation: 0 } },
        {
          id: 'right-edge-real',
          placement: {
            x: 1480 - ONE_SOURCE_PX_MM,
            y: 10,
            rotation: 0,
          },
        },
      ]],
      false,
      placementBounds,
    ));

    const issue = report.boundsIssues.find(
      (item) => item.definitionId === 'body-with-island',
    );
    expect(issue!.overflowMm.left).toBeCloseTo(ONE_SOURCE_PX_MM, 9);
    expect(issue!.message).toContain('borde izquierdo');
  });

  it('acepta contenido visible exactamente en y=5000 y rechaza 1 px físico real de overflow', () => {
    const anchor = definitionAt72Ppi('anchor-y');
    const edge = definitionAt72Ppi('edge-y');
    const polygons = new Map<string, Polygon>([
      ['anchor-y', rect(0, 0, ONE_SOURCE_PX_MM, ONE_SOURCE_PX_MM)],
      ['edge-y', rect(0, 0, ONE_SOURCE_PX_MM, ONE_SOURCE_PX_MM)],
    ]);
    const bounds = new Map([
      ['anchor-y', { x: 0, y: 0, width: 1, height: 1 }],
      ['edge-y', { x: 0, y: 0, width: 1, height: 1 }],
    ]);
    const exact = preflightBatch(batch(
      [anchor, edge],
      polygons,
      bounds,
      [[
        { id: 'anchor-y', placement: { x: 0, y: 0, rotation: 0 } },
        { id: 'edge-y', placement: { x: 10, y: 5000 - ONE_SOURCE_PX_MM, rotation: 0 } },
      ]],
      true,
    ));
    expect(exact.errors).toEqual([]);

    const overflow = preflightBatch(batch(
      [anchor, edge],
      polygons,
      bounds,
      [[
        { id: 'anchor-y', placement: { x: 0, y: 0, rotation: 0 } },
        { id: 'edge-y', placement: { x: 10, y: 5000, rotation: 0 } },
      ]],
      true,
    ));
    const issue = overflow.boundsIssues.find((item) => item.definitionId === 'edge-y');
    expect(issue!.overflowMm.bottom).toBeCloseTo(ONE_SOURCE_PX_MM, 9);
    expect(issue!.message).toMatch(/Canvas 1 · edge-y\.png: .*borde inferior/);
  });
});
