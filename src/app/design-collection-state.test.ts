import { describe, expect, it } from 'vitest';
import {
  buildDesignCollection,
  findCollectionAsset,
  findCollectionReplacementAssets,
  isCollectionComplete,
} from './design-collection-state';

function createFolderFile(
  fileName: string,
  folderName = 'River Suplente 2026',
): File {
  const file = new File(
    ['png'],
    fileName,
    {
      type: 'image/png',
    },
  );

  Object.defineProperty(
    file,
    'webkitRelativePath',
    {
      value: `${folderName}/${fileName}`,
    },
  );

  return file;
}

function buildCompleteFolder(): File[] {
  const files: File[] = [];

  for (let size = 1; size <= 10; size += 1) {
    const frontSequence = String(
      (size - 1) * 2,
    ).padStart(4, '0');

    const backSequence = String(
      (size - 1) * 2 + 1,
    ).padStart(4, '0');

    files.push(
      createFolderFile(
        `RIV26S_${frontSequence}_T${size}-FRENTE.png`,
      ),
    );

    files.push(
      createFolderFile(
        `RIV26S_${backSequence}_T${size}-DORSO.png`,
      ),
    );
  }

  return files;
}

describe('design collection state', () => {
  it('construye una colección completa desde una carpeta', () => {
    const collection = buildDesignCollection(
      buildCompleteFolder(),
      'river-suplente-2026',
    );

    expect(collection.name).toBe(
      'River Suplente 2026',
    );

    expect(collection.assets).toHaveLength(20);
    expect(collection.missing).toHaveLength(0);
    expect(isCollectionComplete(collection)).toBe(true);
  });

  it('conserva la carpeta fuente cuando se proporciona', () => {
    const collection = buildDesignCollection(
      buildCompleteFolder(),
      'river-suplente-2026',
      'C:\\Diseños\\River Suplente 2026',
    );

    expect(collection.sourceFolderPath).toBe(
      'C:\\Diseños\\River Suplente 2026',
    );
  });

  it('conserva los objetos File originales', () => {
    const files = buildCompleteFolder();

    const collection = buildDesignCollection(
      files,
      'river-suplente-2026',
    );

    const front = findCollectionAsset(
      collection,
      'T1',
      'front',
    );

    expect(front?.file).toBe(files[0]);
    expect(front?.fileName).toContain(
      'T1-FRENTE.png',
    );
  });

  it('detecta una colección incompleta', () => {
    const files = buildCompleteFolder().filter(
      (file) =>
        !file.name.includes('T6-DORSO'),
    );

    const collection = buildDesignCollection(
      files,
      'river-suplente-2026',
    );

    expect(collection.assets).toHaveLength(19);
    expect(collection.missing).toContainEqual({
      size: 'T6',
      side: 'back',
    });

    expect(isCollectionComplete(collection)).toBe(false);
  });

  it('permite buscar un talle y lado concreto', () => {
    const collection = buildDesignCollection(
      buildCompleteFolder(),
      'river-suplente-2026',
    );

    const asset = findCollectionAsset(
      collection,
      'T10',
      'back',
    );

    expect(asset?.size).toBe('T10');
    expect(asset?.side).toBe('back');
    expect(asset?.fileName).toContain(
      'T10-DORSO.png',
    );
  });

  it('construye una colección completa con nombres humanos y toma su base', () => {
    const files = Array.from({ length: 10 }, (_, index) => index + 1).flatMap(
      (size) => [
        createFolderFile(`Adoptame t${size} frente.png`, 'Importación'),
        createFolderFile(`Adoptame T${size} DORSO.PNG`, 'Importación'),
      ],
    );
    const collection = buildDesignCollection(files, 'adoptame');

    expect(collection.name).toBe('Adoptame');
    expect(collection.assets).toHaveLength(20);
    expect(collection.missing).toHaveLength(0);
    expect(isCollectionComplete(collection)).toBe(true);
  });
});

it('retains named backs and duplicate recognized backs without changing garment pairing', () => {
  const benji = createFolderFile('aanomBENJI ARG26E_0019_T10-DORSO.png');
  const chicha = createFolderFile('aanomCHICHA ARG26E_0009_T5-DORSO.png');
  const variant = createFolderFile('River JUAN T10 DORSO.png');
  const files = buildCompleteFolder();
  const collection = buildDesignCollection([benji, ...files, chicha, variant, createFolderFile('JUAN.png')], 'river');
  expect(collection.assets).toHaveLength(20);
  expect(collection.replacementAssets?.map(asset => asset.file)).toEqual([benji, chicha, variant]);
  expect(collection.ignoredFileNames).toEqual(['JUAN.png']);
  expect(collection.name).toBe('River Suplente 2026');
  expect(findCollectionAsset(collection, 'T10', 'back')?.file).toBe(files[19]);
  const options = findCollectionReplacementAssets(collection, 'T10', 'back');
  expect(options.map(asset => asset.file)).toEqual([files[19], benji, variant]);
  expect(options.every(asset => asset.size === 'T10' && asset.side === 'back')).toBe(true);
});

it('imports a standalone personalized back with its exact source and no canonical pair', () => {
  const file = createFolderFile('aanomCHICHA ARG26E_0009_T5-DORSO.png');
  const collection = buildDesignCollection([file], 'standalone');
  expect(findCollectionAsset(collection, 'T5', 'front')).toBeUndefined();
  expect(findCollectionAsset(collection, 'T5', 'back')).toBeUndefined();
  expect(findCollectionReplacementAssets(collection, 'T5', 'back')).toEqual([
    expect.objectContaining({ file, fileName: file.name, size: 'T5', side: 'back' }),
  ]);
  expect(isCollectionComplete(collection)).toBe(false);
});

it('adding personalized backs preserves complete canonical Library collections', () => {
  const collection = buildDesignCollection([
    createFolderFile('aanomBENJI ARG26E_0019_T10-DORSO.png'), ...buildCompleteFolder(),
  ], 'river');
  expect(isCollectionComplete(collection)).toBe(true);
  expect(collection.duplicateSlots).toEqual([]);
  expect(collection.missing).toEqual([]);
});
