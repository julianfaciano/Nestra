import { expect, it } from 'vitest';
import {
  extraCounts,
  fillersForInstances,
  pngPieceSummaries,
  toggleFill,
  type FillSetting,
} from './fill-gaps';
import { expandPieceDefinitions } from './piece-instance';
import { groupPiecesByFabric } from './fabric-grouping';
import { preflightBatch } from '../export/export-plan';
import { nativePngPlan } from '../export/native-png-export';
import { fillBatch, fillDefinition } from '../test/fill-gaps-fixture';
import type { GarmentPieceDefinition } from './production-batch';
import { nestMultiplePieces } from '../geometry/multi-piece-nesting-engine';
import { rect } from '../test/fill-gaps-fixture';
import { mm } from './units';

it('assigns monotonic activation priority, preserving it on edits and moving a re-enabled PNG to the end', () => {
  let state: {
    pieces: {
      id: string;
      fill?: FillSetting | undefined;
      quantity: number;
      fabric: string;
    }[];
    lastPriority: number;
  } = {
    pieces: ['a', 'b', 'c'].map((id) => ({
      id,
      quantity: 1,
      fabric: 'deportiva',
    })),
    lastPriority: 0,
  };
  for (const id of ['a', 'b', 'c'])
    state = toggleFill(state.pieces, id, state.lastPriority);
  expect(state.pieces.map((p) => p.fill?.priority)).toEqual([1, 2, 3]);
  expect(state.pieces.map((p) => p.fill?.mode)).toEqual(['normal', 'normal', 'normal']);
  state = toggleFill(state.pieces, 'a', state.lastPriority);
  expect(state.pieces[0]!.fill).toEqual({ priority: 1, mode: 'max' });
  expect(state.lastPriority).toBe(3);
  state = toggleFill(state.pieces, 'a', state.lastPriority);
  expect(state.pieces[0]!.fill).toBeUndefined();
  state.pieces[0] = { ...state.pieces[0]!, quantity: 4, fabric: 'polar' };
  state = toggleFill(state.pieces, 'a', state.lastPriority);
  expect(state.pieces[0]!.fill).toEqual({ priority: 4, mode: 'normal' });
  expect(
    [...state.pieces]
      .sort((a, b) => a.fill!.priority - b.fill!.priority)
      .map((p) => p.id),
  ).toEqual(['b', 'c', 'a']);
  expect(state.lastPriority).toBe(4);
});

it('partitions multiple fillers by the existing fabric grouping and retains activation order', () => {
  const definitions = [
    fillDefinition('a', 20, 20, 3, 4),
    { ...fillDefinition('b', 20, 20, 1, 1), fabric: 'polar' },
    fillDefinition('c', 10, 10, 1, 2),
  ];
  const groups = groupPiecesByFabric(expandPieceDefinitions(definitions));
  expect(
    fillersForInstances(
      groups.find((g) => g.fabric === 'deportiva')!.pieces,
    ).map((f) => f.definitionId),
  ).toEqual(['c', 'a']);
  expect(
    fillersForInstances(groups.find((g) => g.fabric === 'polar')!.pieces).map(
      (f) => f.definitionId,
    ),
  ).toEqual(['b']);
  const batch = fillBatch([fillDefinition('base', 60, 100), ...definitions]);
  expect(extraCounts(batch.results).get('c')).toBeGreaterThan(0);
  expect(extraCounts(batch.results).get('a')).toBeGreaterThan(0);
  for (const result of batch.results)
    for (const piece of result.layouts.flatMap((l) => l.pieces)) {
      if (piece.extra)
        expect(
          definitions.find((d) => d.id === piece.extra!.definitionId)!.fabric,
        ).toBe(result.fabric);
    }
  expect(preflightBatch(batch).errors).toEqual([]);
});

it('keeps three required copies and includes the seven extras in preflight, dedup and the shared export plan', () => {
  const definitions = [
    fillDefinition('base', 60, 100),
    fillDefinition('logo', 20, 20, 3, 1),
  ];
  const batch = fillBatch(definitions);
  const normal = fillBatch(definitions, false);
  const report = preflightBatch(batch);
  expect(report.errors).toEqual([]);
  expect(definitions[1]!.quantity).toBe(3);
  expect(report.layouts[0]!.pieces.filter((p) => p.extra)).toHaveLength(7);
  expect(report.layouts[0]!.heightMm).toBe(
    preflightBatch(normal).layouts[0]!.heightMm,
  );
  expect(extraCounts(batch.results).get('logo')).toBe(7);
  const plan = nativePngPlan(
    report.layouts[0]!,
    new Map([
      ['base', 0],
      ['logo', 1],
    ]),
  );
  expect(plan.pieces).toHaveLength(11);
  expect(pngPieceSummaries(definitions)).toContainEqual({
    name: 'logo.png',
    fabric: 'deportiva',
    count: 3,
  });
  expect(pngPieceSummaries(definitions, extraCounts(batch.results))).toEqual([
    { name: 'logo.png', fabric: 'deportiva', count: 7 },
  ]);
});

it('never allows a Deportivo filler into Polar and rejects a tampered cross-fabric extra', () => {
  const definitions = [
    fillDefinition('base', 60, 100),
    fillDefinition('logo', 20, 20, 1, 1),
    { ...fillDefinition('polar', 60, 100), fabric: 'polar' },
  ];
  const batch = fillBatch(definitions);
  const polar = batch.results.find((r) => r.fabric === 'polar')!;
  expect(polar.layouts.flatMap((l) => l.pieces).some((p) => p.extra)).toBe(
    false,
  );
  const extra = batch.results[0]!.layouts[0]!.pieces.find((p) => p.extra)!;
  const corrupted = {
    ...batch,
    results: [
      ...batch.results.slice(0, 1),
      {
        ...polar,
        layouts: [
          {
            ...polar.layouts[0]!,
            pieces: [...polar.layouts[0]!.pieces, extra],
          },
        ],
      },
    ],
  };
  expect(preflightBatch(corrupted).errors.join()).toContain('Mezcla de telas');
});

it('preflight rejects unauthorized extras, expanded material and extra-only layouts', () => {
  const definitions = [
    fillDefinition('base', 60, 100),
    fillDefinition('logo', 20, 20, 3, 1),
  ];
  const batch = fillBatch(definitions),
    result = batch.results[0]!,
    layout = result.layouts[0]!;
  expect(
    preflightBatch({
      ...batch,
      definitions: definitions.map((d) => ({ ...d, fill: undefined })),
    }).errors.join(),
  ).toContain('Relleno no autorizado');
  expect(
    preflightBatch({
      ...batch,
      results: [
        {
          ...result,
          layouts: [{ ...layout, usedHeight: layout.usedHeight + 10 }],
        },
      ],
    }).errors.join(),
  ).toContain('material requerido');
  expect(
    preflightBatch({
      ...batch,
      results: [
        {
          ...result,
          layouts: [
            layout,
            {
              ...layout,
              index: 1,
              pieces: layout.pieces.filter((p) => p.extra),
            },
          ],
        },
      ],
    }).errors.join(),
  ).toContain('creó un canvas');
  const moved = layout.pieces.map((piece) =>
    piece.extra
      ? { ...piece, placement: { ...piece.placement, y: 110 } }
      : piece,
  );
  expect(
    preflightBatch({
      ...batch,
      results: [{ ...result, layouts: [{ ...layout, pieces: moved }] }],
    }).errors.join(),
  ).toContain('altura requerida');
});

it('retains garment pairing and placements when free PNG fillers are enabled', () => {
  const front: GarmentPieceDefinition = {
    ...fillDefinition('front', 30, 100),
    kind: 'garment',
    model: 'shirt',
    size: 'T8',
    side: 'front',
  };
  const back: GarmentPieceDefinition = { ...front, id: 'back', side: 'back' };
  const definitions = [front, back, fillDefinition('logo', 20, 20, 3, 1)];
  const required = fillBatch(definitions, false),
    filled = fillBatch(definitions);
  expect(
    filled.results[0]!.layouts.flatMap((l) => l.pieces).filter((p) => !p.extra),
  ).toEqual(required.results[0]!.layouts.flatMap((l) => l.pieces));
  expect(preflightBatch(filled).errors).toEqual([]);
  expect(
    preflightBatch(fillBatch([front, definitions[2]!])).errors.join(),
  ).toContain('Frente/dorso');
});

it('summarizes only productive fillers and groups actual counts by filename and fabric', () => {
  const definitions = [
    fillDefinition('base', 60, 100),
    fillDefinition('a', 20, 20, 1, 1),
    fillDefinition('b', 20, 20, 1, 2),
  ];
  const batch = fillBatch(definitions);
  expect(pngPieceSummaries(definitions, extraCounts(batch.results))).toEqual([
    { name: 'a.png', fabric: 'deportiva', count: 4 },
    { name: 'b.png', fabric: 'deportiva', count: 4 },
  ]);
  expect(
    pngPieceSummaries(
      [definitions[1]!, { ...definitions[2]!, fileName: 'a.png' }],
      new Map([
        ['a', 7],
        ['b', 3],
      ]),
    ),
  ).toEqual([{ name: 'a.png', fabric: 'deportiva', count: 10 }]);
});

it('deduplicates visually identical filled canvases without losing the actual extra counter', () => {
  const batch = fillBatch([
    fillDefinition('base', 60, 200, 2),
    fillDefinition('logo', 20, 20, 2, 1),
  ]);
  expect(batch.results[0]!.layouts).toHaveLength(2);
  expect(extraCounts(batch.results).get('logo')).toBe(38);
  const report = preflightBatch(batch);
  expect(report.errors).toEqual([]);
  expect(report.layouts).toHaveLength(1);
  expect(report.layouts[0]!.name).toBe('deportiva_2_copias.png');
  expect(report.layouts[0]!.pieces).toHaveLength(21);
});

it('does not enlarge the PDF vertical envelope through transparent PNG margins', () => {
  const definitions = [
    fillDefinition('base', 60, 100),
    fillDefinition('logo', 40, 40, 1, 1),
  ];
  const polygons = new Map([
    ['base', rect(60, 100)],
    ['logo', rect(20, 20).map((p) => ({ x: p.x + 10.125, y: p.y + 10.125 }))],
  ]);
  const pieces = expandPieceDefinitions(definitions).map((instance) => ({
    id: instance.id,
    polygon: polygons.get(instance.definitionId)!,
    allowedRotations: [0] as const,
    artworkSize: {
      width: instance.definition.physicalWidthMm,
      height: instance.definition.physicalHeightMm,
    },
  }));
  const base = {
    definitions,
    polygons,
    profile: {
      ...fillBatch(definitions).profile,
      maxWidth: mm(100),
      maxHeight: mm(200),
    },
  };
  const required = nestMultiplePieces({
    pieces,
    canvas: { width: 100, height: 200 },
    scanStepMm: 10,
  });
  const filled = nestMultiplePieces({
    pieces,
    canvas: { width: 100, height: 200 },
    scanStepMm: 10,
    fillers: [{ definitionId: 'logo', requiredPieceId: 'logo-1', priority: 1, mode: 'normal' }],
  });
  const before = preflightBatch({
    ...base,
    results: [{ fabric: 'deportiva', elapsedMs: 0, ...required }],
  });
  const after = preflightBatch({
    ...base,
    results: [{ fabric: 'deportiva', elapsedMs: 0, ...filled }],
  });
  expect(filled.extraCount).toBeGreaterThan(0);
  expect(after.errors).toEqual([]);
  expect(after.layouts[0]!.heightMm).toBe(before.layouts[0]!.heightMm);
  expect(after.layouts[0]!.heightPx).toBe(before.layouts[0]!.heightPx);
  expect(after.layouts[0]!.offsetY).toBe(before.layouts[0]!.offsetY);
  expect(filled.layouts.map((l) => l.usedHeight)).toEqual(
    required.layouts.map((l) => l.usedHeight),
  );
});
