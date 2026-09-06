import 'fake-indexeddb/auto';
import {
  describe,
  expect,
  it,
} from 'vitest';
import type { DesignCollection } from '../app/design-collection-state';
import {
  loadDesignCollections,
  saveDesignCollections,
  serializeDesignCollections,
  validateStoredDesignCollections,
} from './design-collections';

function createCollection(): DesignCollection {
  const frontFile = new File(
    ['front'],
    'RIV26S_0000_T1-FRENTE.png',
    {
      type: 'image/png',
    },
  );

  const backFile = new File(
    ['back'],
    'RIV26S_0001_T1-DORSO.png',
    {
      type: 'image/png',
    },
  );

  const masterFront = new File(
  ['master-front'],
  '00RIV26S (F).png',
  {
    type: 'image/png',
  },
);

const masterBack = new File(
  ['master-back'],
  '00RIV26S (D).png',
  {
    type: 'image/png',
  },
);

  return {
    id: 'river-suplente-2026',
    name: 'River Suplente 2026',
    assets: [
      {
        size: 'T1',
        side: 'front',
        file: frontFile,
        fileName: frontFile.name,
        relativePath:
          'River Suplente 2026/' +
          frontFile.name,
      },
      {
        size: 'T1',
        side: 'back',
        file: backFile,
        fileName: backFile.name,
        relativePath:
          'River Suplente 2026/' +
          backFile.name,
      },
    ],
    masterAssets: [
  {
    side: 'front',
    file: masterFront,
    fileName: masterFront.name,
    relativePath:
      'River Suplente 2026/' +
      masterFront.name,
  },
  {
    side: 'back',
    file: masterBack,
    fileName: masterBack.name,
    relativePath:
      'River Suplente 2026/' +
      masterBack.name,
  },
],
    missing: [],
    duplicateSlots: [],
    ignoredFileNames: [],
  };
}

describe('design collections persistence', () => {
    it('serializa los maestros de preview para persistencia', () => {
  const stored = serializeDesignCollections([
    createCollection(),
  ]);

  validateStoredDesignCollections(stored);

  const collection = stored.collections[0];

  expect(collection).toBeDefined();
  expect(collection?.masterAssets).toHaveLength(2);

  const front = collection?.masterAssets?.find(
    (asset) => asset.side === 'front',
  );

  const back = collection?.masterAssets?.find(
    (asset) => asset.side === 'back',
  );

  expect(front?.fileName).toBe(
    '00RIV26S (F).png',
  );

  expect(back?.fileName).toBe(
    '00RIV26S (D).png',
  );

  expect(front?.image).toBeInstanceOf(Blob);
  expect(back?.image).toBeInstanceOf(Blob);
});
  it('serializa PNG como blobs', () => {
    const stored = serializeDesignCollections([
      createCollection(),
    ]);

    expect(stored.collections).toHaveLength(1);

    expect(
      stored.collections[0]?.assets[0]?.image,
    ).toBeInstanceOf(Blob);
  });

  it('serializa una colección conservando sus archivos y metadatos', () => {
  const stored = serializeDesignCollections([
    createCollection(),
  ]);

  const collection = stored.collections[0];

  expect(collection?.name).toBe(
    'River Suplente 2026',
  );

  expect(collection?.assets).toHaveLength(2);

  expect(
    collection?.assets[0]?.fileName,
  ).toContain('T1-FRENTE');

  expect(
    collection?.assets[0]?.image,
  ).toBeInstanceOf(Blob);
});

  it('reemplaza el estado guardado completo', async () => {
    await saveDesignCollections([
      createCollection(),
    ]);

    await saveDesignCollections([]);

    expect(
      await loadDesignCollections(),
    ).toEqual([]);
  });

  it('rechaza un slot duplicado', () => {
    const stored = serializeDesignCollections([
      createCollection(),
    ]);

    const collection =
      stored.collections[0];

    if (!collection) {
      throw new Error('Falta colección de prueba.');
    }

    const first = collection.assets[0];

    if (!first) {
      throw new Error('Falta asset de prueba.');
    }

    expect(() =>
      validateStoredDesignCollections({
        version: 1,
        collections: [
          {
            ...collection,
            assets: [
              ...collection.assets,
              first,
            ],
          },
        ],
      }),
    ).toThrow('duplicado');
  });
});