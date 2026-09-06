import { expect, it } from 'vitest';
import { expandPieceDefinitions } from './piece-instance';
import { getAllowedRotationsForPiece } from './piece-rotation';
import type { GarmentPieceDefinition } from './production-batch';
import { preflightBatch } from '../export/export-plan';
import { nativePngPlan } from '../export/native-png-export';
import {
  freePngDefinition,
  prepareFreePngBatch,
} from '../test/free-png-fixture';

it('expands three free PNGs into exactly three pieces without garment fields or pairing', () => {
  const free = freePngDefinition();
  const instances = expandPieceDefinitions([free]);
  expect(instances.map((p) => p.id)).toEqual(['logo-1', 'logo-2', 'logo-3']);
  expect(free).not.toHaveProperty('side');
  expect(free).not.toHaveProperty('size');
  expect(free).not.toHaveProperty('model');
  const batch = prepareFreePngBatch([free]);
  expect(batch.results[0]!.layouts.flatMap((l) => l.pieces)).toHaveLength(3);
  expect(preflightBatch(batch).errors).toEqual([]);
});

it('uses 72 PPI and all four rotations for free PNGs, preserving garment rules', () => {
  const free = freePngDefinition();
  expect(free.physicalWidthMm).toBe(25.4);
  expect(free.physicalHeightMm).toBe(25.4);
  expect(getAllowedRotationsForPiece(free)).toEqual([0, 90, -90, 180]);
  const garment: GarmentPieceDefinition = {
    ...free,
    kind: 'garment',
    model: 'River',
    size: 'T8',
    side: 'front',
  };
  expect(getAllowedRotationsForPiece(garment)).toEqual([0, 90, 180, -90]);
  expect(getAllowedRotationsForPiece({ ...garment, side: 'back' })).toEqual([
    0, 180,
  ]);
});

it('shares the same fabric canvas, preflight and native export plan with garments', () => {
  const free = freePngDefinition(1);
  const front: GarmentPieceDefinition = {
    ...free,
    kind: 'garment',
    id: 'front',
    model: 'River',
    size: 'T8',
    side: 'front',
  };
  const back: GarmentPieceDefinition = { ...front, id: 'back', side: 'back' };
  const batch = prepareFreePngBatch([front, back, free]);
  expect(batch.results).toHaveLength(1);
  expect(batch.results[0]!.layouts).toHaveLength(1);
  const report = preflightBatch(batch);
  expect(report.errors).toEqual([]);
  expect(report.layouts[0]!.pieces).toHaveLength(3);
  const plan = nativePngPlan(
    report.layouts[0]!,
    new Map([
      ['front', 0],
      ['back', 1],
      ['logo', 2],
    ]),
  );
  expect(plan.pieces).toHaveLength(3);
  expect(
    preflightBatch(prepareFreePngBatch([front, free])).errors.join(),
  ).toContain('Frente/dorso');
  expect(
    prepareFreePngBatch([front, back, { ...free, fabric: 'polar' }]).results,
  ).toHaveLength(2);
});

it.each([0, -1, 1.5, NaN, Infinity])(
  'rejects invalid free PNG quantity %s',
  (quantity) => {
    expect(() =>
      expandPieceDefinitions([freePngDefinition(quantity)]),
    ).toThrow();
  },
);
