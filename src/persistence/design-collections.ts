import type {
  DesignCollection,
  DesignCollectionMasterAsset,
} from '../app/design-collection-state';
import { PIECE_SIDES } from '../domain/piece-side';
import { GARMENT_SIZES } from '../domain/size';

const DB_NAME = 'nestra-design-collections';
const STORE = 'collections';
const KEY = 'current';

interface StoredDesignAsset {
  readonly size: DesignCollection['assets'][number]['size'];
  readonly side: DesignCollection['assets'][number]['side'];
  readonly fileName: string;
  readonly relativePath: string;
  readonly image: Blob;
}

interface StoredDesignMasterAsset {
  readonly side: DesignCollectionMasterAsset['side'];
  readonly fileName: string;
  readonly relativePath: string;
  readonly image: Blob;
}

interface StoredDesignCollection {
  readonly id: string;
  readonly name: string;
  readonly assets: readonly StoredDesignAsset[];
  readonly masterAssets?: readonly StoredDesignMasterAsset[];
  readonly missing: DesignCollection['missing'];
  readonly duplicateSlots: readonly string[];
  readonly ignoredFileNames: readonly string[];
  readonly sourceFolderPath?: string;
}

interface StoredDesignCollections {
  readonly version: 1;
  readonly collections: readonly StoredDesignCollection[];
}

function record(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPngBlob(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as {
    readonly type?: unknown;
    readonly size?: unknown;
  };

  return (
    candidate.type === 'image/png' &&
    typeof candidate.size === 'number' &&
    Number.isFinite(candidate.size) &&
    candidate.size >= 0 &&
    candidate.size <= 32 * 1024 * 1024
  );
}

export function serializeDesignCollections(
  collections: readonly DesignCollection[],
): StoredDesignCollections {
  return {
    version: 1,

    collections: collections.map((collection) => ({
      id: collection.id,
      name: collection.name,

      assets: collection.assets.map((asset) => ({
        size: asset.size,
        side: asset.side,
        fileName: asset.fileName,
        relativePath: asset.relativePath,
        image: new Blob(
          [asset.file],
          {
            type: 'image/png',
          },
        ),
      })),

      ...(collection.masterAssets
        ? {
            masterAssets: collection.masterAssets.map(
              (asset) => ({
                side: asset.side,
                fileName: asset.fileName,
                relativePath: asset.relativePath,
                image: new Blob(
                  [asset.file],
                  {
                    type: 'image/png',
                  },
                ),
              }),
            ),
          }
        : {}),

      missing: collection.missing,
      duplicateSlots: collection.duplicateSlots,
      ignoredFileNames: collection.ignoredFileNames,
      ...(collection.sourceFolderPath ? { sourceFolderPath: collection.sourceFolderPath } : {}),
    })),
  };
}

export function validateStoredDesignCollections(
  value: unknown,
): asserts value is StoredDesignCollections {
  if (
    !record(value) ||
    value.version !== 1 ||
    !Array.isArray(value.collections) ||
    value.collections.length > 200
  ) {
    throw new Error(
      'Biblioteca de diseños inválida o versión no soportada.',
    );
  }

  const collectionIds = new Set<string>();

  for (const collection of value.collections) {
    if (
      !record(collection) ||
      typeof collection.id !== 'string' ||
      collection.id.trim().length === 0 ||
      typeof collection.name !== 'string' ||
      collection.name.trim().length === 0 ||
      !Array.isArray(collection.assets) ||
      collection.assets.length > 20 ||
      !Array.isArray(collection.missing) ||
      !Array.isArray(collection.duplicateSlots) ||
      !Array.isArray(collection.ignoredFileNames)
    ) {
      throw new Error(
        'Colección de diseños local inválida.',
      );
    }

    if (collection.sourceFolderPath !== undefined && typeof collection.sourceFolderPath !== 'string') {
      throw new Error('Carpeta fuente inválida en colección de diseños.');
    }

    if (collectionIds.has(collection.id)) {
      throw new Error(
        'Colección de diseños duplicada.',
      );
    }

    collectionIds.add(collection.id);

    const slots = new Set<string>();

    for (const asset of collection.assets) {
      if (
        !record(asset) ||
        !GARMENT_SIZES.some(
          (size) => size === asset.size,
        ) ||
        !PIECE_SIDES.some(
          (side) => side === asset.side,
        ) ||
        typeof asset.fileName !== 'string' ||
        typeof asset.relativePath !== 'string' ||
        !isPngBlob(asset.image)
      ) {
        throw new Error(
          'Archivo inválido en colección de diseños.',
        );
      }

      const slot = `${String(asset.size)}/${String(
        asset.side,
      )}`;

      if (slots.has(slot)) {
        throw new Error(
          'Talle/lado duplicado en colección guardada.',
        );
      }

      slots.add(slot);
    }

    if (collection.masterAssets !== undefined) {
      if (
        !Array.isArray(collection.masterAssets) ||
        collection.masterAssets.length > 2
      ) {
        throw new Error(
          'Maestros inválidos en colección de diseños.',
        );
      }

      const masterSides = new Set<string>();

      for (const master of collection.masterAssets) {
        if (
          !record(master) ||
          !PIECE_SIDES.some(
            (side) => side === master.side,
          ) ||
          typeof master.fileName !== 'string' ||
          typeof master.relativePath !== 'string' ||
          !isPngBlob(master.image)
        ) {
          throw new Error(
            'Archivo maestro inválido en colección de diseños.',
          );
        }

        const side = String(master.side);

        if (masterSides.has(side)) {
          throw new Error(
            'Lado maestro duplicado en colección guardada.',
          );
        }

        masterSides.add(side);
      }
    }

    for (const missing of collection.missing) {
      if (
        !record(missing) ||
        !GARMENT_SIZES.some(
          (size) => size === missing.size,
        ) ||
        !PIECE_SIDES.some(
          (side) => side === missing.side,
        )
      ) {
        throw new Error(
          'Pieza faltante inválida en colección guardada.',
        );
      }
    }

    if (
      !collection.duplicateSlots.every(
        (item) => typeof item === 'string',
      ) ||
      !collection.ignoredFileNames.every(
        (item) => typeof item === 'string',
      )
    ) {
      throw new Error(
        'Metadatos inválidos en colección guardada.',
      );
    }
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('IndexedDB no disponible.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE);
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(
        request.error ??
          new Error(
            'No se pudo abrir la biblioteca de diseños.',
          ),
      );
    };

    request.onblocked = () => {
      reject(
        new Error(
          'Cerrá otras ventanas de Nestra para abrir la biblioteca de diseños.',
        ),
      );
    };
  });
}

export async function loadDesignCollections(): Promise<
  DesignCollection[]
> {
  const db = await openDatabase();

  try {
    const value: unknown = await new Promise(
      (resolve, reject) => {
        const transaction = db.transaction(
          STORE,
          'readonly',
        );

        const request = transaction
          .objectStore(STORE)
          .get(KEY);

        request.onsuccess = () => {
          resolve(request.result);
        };

        request.onerror = () => {
          reject(request.error);
        };
      },
    );

    if (value === undefined) {
      return [];
    }

    validateStoredDesignCollections(value);

    return value.collections.map((collection) => ({
      id: collection.id,
      name: collection.name,

      assets: collection.assets.map((asset) => ({
        size: asset.size,
        side: asset.side,
        fileName: asset.fileName,
        relativePath: asset.relativePath,

        file: new File(
          [asset.image],
          asset.fileName,
          {
            type: 'image/png',
          },
        ),
      })),

      ...(collection.masterAssets
        ? {
            masterAssets: collection.masterAssets.map(
              (asset) => ({
                side: asset.side,
                fileName: asset.fileName,
                relativePath: asset.relativePath,

                file: new File(
                  [asset.image],
                  asset.fileName,
                  {
                    type: 'image/png',
                  },
                ),
              }),
            ),
          }
        : {}),

      missing: collection.missing,
      duplicateSlots: collection.duplicateSlots,
      ignoredFileNames: collection.ignoredFileNames,
      ...(collection.sourceFolderPath ? { sourceFolderPath: collection.sourceFolderPath } : {}),
    }));
  } finally {
    db.close();
  }
}

export async function saveDesignCollections(
  collections: readonly DesignCollection[],
): Promise<void> {
  const value =
    serializeDesignCollections(collections);

  validateStoredDesignCollections(value);

  const db = await openDatabase();

  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(
        STORE,
        'readwrite',
      );

      transaction
        .objectStore(STORE)
        .put(value, KEY);

      transaction.oncomplete = () => {
        resolve();
      };

      transaction.onerror = () => {
        reject(transaction.error);
      };

      transaction.onabort = () => {
        reject(
          transaction.error ??
            new Error(
              'Guardado de diseños cancelado.',
            ),
        );
      };
    });
  } finally {
    db.close();
  }
}
