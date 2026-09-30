import { describe, expect, it } from 'vitest';
import { parseDesignAssetFilename, parseReplacementAssetFilename } from './design-asset-filename';

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

describe('parseReplacementAssetFilename', () => {
  it.each([
    ['aanomBENJI ARG26E_0019_T10-DORSO.png', 'T10'],
    ['aanomCHICHA ARG26E_0009_T5-DORSO.png', 'T5'],
  ] as const)('identifies the existing personalized format %s only for replacement', (name, size) => {
    expect(parseReplacementAssetFilename(name)).toEqual({ size, side: 'back' });
    expect(parseDesignAssetFilename(name)).toBeNull();
  });

  it.each([
    'preview.png', 'JUAN.png',
    'aanomJUAN ARG26E_0019_T11-DORSO.png',
    'JUAN ARG26E_0019_T10-DORSO.png',
    'aanomJUAN ARG26E_0019_T10-DORSO.png.bak',
    'nomJUANT4.png', 'nom_T40.png', 'nom_T04.png', 'nom_T0.png',
    'nom_T4_T8.png', 'nom_T4_T11.png', 'nom/file_T4.png',
    'nom_modelo_2026_4.png',
  ])('rejects arbitrary or ambiguous source %s', name => {
    expect(parseReplacementAssetFilename(name)).toBeNull();
  });

  it.each([
    ['aanomFIRULAIS SLE_D_T4.png', 'T4'],
    ['aanomFIRULAISLE_D_T4.png', 'T4'],
    ['NOMJUAN_SLE_D_T4.png', 'T4'],
    ['PedroNomSLE_D_T8.png', 'T8'],
    ['abc_nom_algo_T10.png', 'T10'],
    ['abc_nOm_algo_t10.PNG', 'T10'],
    ['T4_nom.png', 'T4'],
    ['nom-T4-edicion.png', 'T4'],
    ['nom T4 edicion.png', 'T4'],
    ['aanomJUAN ARG26E_0007_T5-DORSO.png', 'T5'],
    ['aanomJUAN ARG26E_0018_T10-FRENTE.png', 'T10'],
    ['aanomJUAN preview T8 BACK.png', 'T8'],
  ] as const)('recognizes the productive nom convention %s as BACK %s', (name, size) => {
    expect(parseReplacementAssetFilename(name)).toEqual({ size, side: 'back' });
  });

  it.each(Array.from({ length: 10 }, (_, index) => index + 1))('supports existing size T%s with nom', number => {
    expect(parseReplacementAssetFilename(`nom_SLE_T${number}.png`)).toEqual({ size: `T${number}`, side: 'back' });
  });
});
