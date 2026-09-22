import { describe, expect, it } from 'vitest';
import { parseDesignAssetFilename } from './design-asset-filename';

describe('parseDesignAssetFilename', () => {
  it('reconoce T1 frente', () => {
    expect(
      parseDesignAssetFilename(
        'RIV26S_0000_T1-FRENTE.png',
      ),
    ).toEqual({
      size: 'T1',
      side: 'front',
    });
  });

  it('reconoce T1 dorso', () => {
    expect(
      parseDesignAssetFilename(
        'RIV26S_0001_T1-DORSO.png',
      ),
    ).toEqual({
      size: 'T1',
      side: 'back',
    });
  });

  it('reconoce T5 frente y dorso', () => {
    expect(
      parseDesignAssetFilename(
        'ARG26E_0008_T5-FRENTE.png',
      ),
    ).toEqual({
      size: 'T5',
      side: 'front',
    });

    expect(
      parseDesignAssetFilename(
        'ARG26E_0009_T5-DORSO.png',
      ),
    ).toEqual({
      size: 'T5',
      side: 'back',
    });
  });

  it('reconoce T10 frente y dorso', () => {
    expect(
      parseDesignAssetFilename(
        'ARG26E_0018_T10-FRENTE.png',
      ),
    ).toEqual({
      size: 'T10',
      side: 'front',
    });

    expect(
      parseDesignAssetFilename(
        'ARG26E_0019_T10-DORSO.png',
      ),
    ).toEqual({
      size: 'T10',
      side: 'back',
    });
  });

  it('rechaza personalizados con texto delante', () => {
    expect(
      parseDesignAssetFilename(
        'aanomBENJI ARG26E_0019_T10-DORSO.png',
      ),
    ).toBeNull();

    expect(
      parseDesignAssetFilename(
        'aanomCHICHA ARG26E_0009_T5-DORSO.png',
      ),
    ).toBeNull();
  });

  it('rechaza código numérico que no corresponde al talle', () => {
    expect(
      parseDesignAssetFilename(
        'ARG26E_0007_T5-DORSO.png',
      ),
    ).toBeNull();

    expect(
      parseDesignAssetFilename(
        'ARG26E_0019_T1-DORSO.png',
      ),
    ).toBeNull();
  });

  it('acepta mayúsculas o minúsculas', () => {
    expect(
      parseDesignAssetFilename(
        'arg26e_0011_t6-dorso.PNG',
      ),
    ).toEqual({
      size: 'T6',
      side: 'back',
    });
  });

  it.each([
    ['Adoptame t1 frente.png', 'T1', 'front'],
    ['Adoptame t1 dorso.png', 'T1', 'back'],
    ['Adoptame T10 DORSO.PNG', 'T10', 'back'],
    ['Mi diseño 2026_T2-FRENTE.png', 'T2', 'front'],
  ] as const)('reconoce el formato humano %s', (fileName, size, side) => {
    expect(parseDesignAssetFilename(fileName)).toEqual({
      designName: fileName.startsWith('Mi') ? 'Mi diseño 2026' : 'Adoptame',
      size,
      side,
    });
  });

  it('sólo interpreta talle y lado como tokens terminales', () => {
    expect(parseDesignAssetFilename('Modelo T2 edición frente.png')).toBeNull();
    expect(parseDesignAssetFilename('Adoptame T11 frente.png')).toBeNull();
    expect(parseDesignAssetFilename('Adoptame T1 lateral.png')).toBeNull();
  });

  it('ignora archivos que no siguen el formato', () => {
    expect(
      parseDesignAssetFilename('preview.png'),
    ).toBeNull();

    expect(
      parseDesignAssetFilename(
        'ARG26E_0004_T3-FRENTE.psd',
      ),
    ).toBeNull();
  });
});
