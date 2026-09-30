import { describe, expect, it } from 'vitest';
import {
  collectionNameFromRelativePath,
  scanDesignCollection,
  type DesignFileCandidate,
} from './design-collection';

function buildCompleteFolder(): DesignFileCandidate[] {
  const files: DesignFileCandidate[] = [];

  for (let size = 1; size <= 10; size += 1) {
    const frontSequence = String(
      (size - 1) * 2,
    ).padStart(4, '0');

    const backSequence = String(
      (size - 1) * 2 + 1,
    ).padStart(4, '0');

    const frontFileName =
      `RIV26S_${frontSequence}_T${size}-FRENTE.png`;

    const backFileName =
      `RIV26S_${backSequence}_T${size}-DORSO.png`;

    files.push({
      fileName: frontFileName,
      relativePath:
        `River Suplente 2026/${frontFileName}`,
    });

    files.push({
      fileName: backFileName,
      relativePath:
        `River Suplente 2026/${backFileName}`,
    });
  }

  return files;
}

describe('design collection', () => {
  it('toma el nombre de la carpeta raíz', () => {
    expect(
      collectionNameFromRelativePath(
        'River Suplente 2026/RIV26S_0000_T1-FRENTE.png',
      ),
    ).toBe('River Suplente 2026');
  });

  it('reconoce una carpeta completa de T1 a T10', () => {
    const result = scanDesignCollection(
      buildCompleteFolder(),
    );

    expect(result.name).toBe('River Suplente 2026');
    expect(result.assets).toHaveLength(20);
    expect(result.missing).toHaveLength(0);
    expect(result.duplicateSlots).toHaveLength(0);
  });

  it('informa piezas faltantes', () => {
    const files = buildCompleteFolder().filter(
      (file) =>
        !file.fileName.includes('T4-DORSO'),
    );

    const result = scanDesignCollection(files);

    expect(result.assets).toHaveLength(19);
    expect(result.missing).toContainEqual({
      size: 'T4',
      side: 'back',
    });
  });

  it('ignora archivos auxiliares', () => {
    const files = [
      ...buildCompleteFolder(),
      {
        fileName: 'preview.png',
        relativePath:
          'River Suplente 2026/preview.png',
      },
      {
        fileName: 'notas.txt',
        relativePath:
          'River Suplente 2026/notas.txt',
      },
    ];

    const result = scanDesignCollection(files);

    expect(result.assets).toHaveLength(20);
    expect(result.ignoredFileNames).toEqual([
      'preview.png',
      'notas.txt',
    ]);
  });

  it('detecta dos archivos para el mismo talle y lado', () => {
    const files = [
      ...buildCompleteFolder(),
      {
        fileName: 'OTRO_0000_T1-FRENTE.png',
        relativePath:
  'River Suplente 2026/OTRO_0000_T1-FRENTE.png',
      },
    ];

    const result = scanDesignCollection(files);

    expect(result.assets).toHaveLength(20);
    expect(result.duplicateSlots).toContain(
      'T1:front',
    );
  });
});

it.each([true, false])('keeps nom sources outside canonical slots regardless of file order (named first=%s)', namedFirst => {
  const folder = 'San Lorenzo Escudo';
  const canonical = ['SLE_0006_T4-FRENTE.png', 'SLE_0007_T4-DORSO.png'];
  const named = ['aanomFIRULAIS SLE_D_T4.png', 'nomSLE_0007_T4-DORSO.png', 'nom SLE T4 FRENTE.png'];
  const result = scanDesignCollection((namedFirst ? [...named, ...canonical] : [...canonical, ...named])
    .map(fileName => ({ fileName, relativePath: `${folder}/${fileName}` })));
  expect(result.name).toBe(folder);
  expect(result.assets.map(asset => asset.fileName)).toEqual(canonical);
  expect(result.replacementAssets.map(asset => asset.fileName)).toEqual(named);
  expect(result.replacementAssets.every(asset => asset.size === 'T4' && asset.side === 'back')).toBe(true);
  expect(result.duplicateSlots).toEqual([]);
  expect(result.ignoredFileNames).toEqual([]);
});

it('ignores nom files with unknown or conflicting size evidence without occupying a garment slot', () => {
  const names = ['nom T4 T8 DORSO.png', 'nom_SLE_T11.png', 'nom_modelo2026.png'];
  const result = scanDesignCollection(names.map(fileName => ({ fileName, relativePath: `San Lorenzo Escudo/${fileName}` })));
  expect(result.assets).toEqual([]);
  expect(result.replacementAssets).toEqual([]);
  expect(result.ignoredFileNames).toEqual(names);
});
