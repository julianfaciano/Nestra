import { describe, expect, it } from 'vitest';
import { mm } from './units';
import type { GarmentPieceDefinition } from './production-batch';
import { expandPieceDefinitions } from './piece-instance';
import { groupPiecesByFabric } from './fabric-grouping';
import { getAllowedRotationsForSide } from './piece-rotation';

function createDefinition(
  overrides: Partial<GarmentPieceDefinition> = {},
): GarmentPieceDefinition {
  return {
    kind: 'garment',
    id: 'river-t8-front-deportiva',
    model: 'River',
    size: 'T8',
    side: 'front',
    fabric: 'deportiva',
    quantity: 3,
    fileName: 'river-t8-frente.png',
    imageUrl: 'blob:test',
    sourceWidthPx: 985,
    sourceHeightPx: 1226,
    physicalWidthMm: mm(400),
    physicalHeightMm: mm(500),
    alphaThreshold: 16,
    simplificationTolerancePx: 1.5,
    ...overrides,
  };
}

describe('ProductionBatch', () => {
  it('expande cantidades en instancias individuales', () => {
    const instances = expandPieceDefinitions([
      createDefinition({
        quantity: 3,
      }),
    ]);

    expect(instances).toHaveLength(3);
    expect(instances[0]?.id).toBe('river-t8-front-deportiva-1');
    expect(instances[2]?.id).toBe('river-t8-front-deportiva-3');
  });

  it('agrupa piezas por tela', () => {
    const instances = expandPieceDefinitions([
      createDefinition({
        id: 'river-front',
        fabric: 'deportiva',
        quantity: 2,
      }),
      createDefinition({
        id: 'boca-front',
        model: 'Boca',
        fabric: 'polar',
        quantity: 1,
      }),
    ]);

    const groups = groupPiecesByFabric(instances);

    expect(groups).toHaveLength(2);

    expect(
      groups.find((group) => group.fabric === 'deportiva')?.pieces,
    ).toHaveLength(2);

    expect(
      groups.find((group) => group.fabric === 'polar')?.pieces,
    ).toHaveLength(1);
  });

  it('normaliza nombres de tela', () => {
    const instances = expandPieceDefinitions([
      createDefinition({
        fabric: ' Deportiva ',
        quantity: 1,
      }),
      createDefinition({
        id: 'river-back',
        side: 'back',
        fabric: 'DEPORTIVA',
        quantity: 1,
      }),
    ]);

    const groups = groupPiecesByFabric(instances);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.fabric).toBe('deportiva');
    expect(groups[0]?.pieces).toHaveLength(2);
  });

  it('permite 90 grados para frente', () => {
    expect(getAllowedRotationsForSide('front')).toEqual([0, 90, 180, -90]);
  });

  it('no permite 90 grados para dorso', () => {
    expect(getAllowedRotationsForSide('back')).toEqual([0, 180]);
  });
});
