import type { Polygon } from '../geometry/polygon';

const DB_NAME = 'nestra-contour-cache';
const STORE = 'contours';
const DB_VERSION = 1;

/*
 * Subir esta versión invalida automáticamente todos los contornos
 * persistidos si en el futuro cambia el algoritmo geométrico.
 */
const CONTOUR_ALGORITHM_VERSION = 1;

export interface CachedContourPair {
  readonly fastPolygon: Polygon;
  readonly finePolygon: Polygon;
}

interface StoredContourPair {
  readonly version: 1;
  readonly fastPolygon: Polygon;
  readonly finePolygon: Polygon;
}

interface ContourCacheKeyOptions {
  readonly alphaThreshold: number;
  readonly fastSimplificationPx: number;
  readonly fineSimplificationPx: number;
  readonly physicalWidthMm: number;
  readonly physicalHeightMm: number;
}

/*
 * Durante una misma sesión el mismo File puede aparecer varias veces.
 * Evitamos volver a calcular SHA-256 para ese objeto.
 */
const hashByFile = new WeakMap<File, Promise<string>>();

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function hashFile(file: File): Promise<string> {
  const existing = hashByFile.get(file);

  if (existing) {
    return existing;
  }

  const pending = (async () => {
    if (!globalThis.crypto?.subtle) {
      throw new Error('SHA-256 no disponible.');
    }

    const bytes = await file.arrayBuffer();
    const digest = await globalThis.crypto.subtle.digest(
      'SHA-256',
      bytes,
    );

    return bufferToHex(digest);
  })();

  hashByFile.set(file, pending);

  return pending;
}

export async function buildContourCacheKey(
  file: File,
  options: ContourCacheKeyOptions,
): Promise<string> {
  const hash = await hashFile(file);

  return [
    `algorithm:${CONTOUR_ALGORITHM_VERSION}`,
    `sha256:${hash}`,
    `alpha:${options.alphaThreshold}`,
    `fast:${options.fastSimplificationPx}`,
    `fine:${options.fineSimplificationPx}`,
    `width:${options.physicalWidthMm.toFixed(6)}`,
    `height:${options.physicalHeightMm.toFixed(6)}`,
  ].join('|');
}

function record(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPolygon(value: unknown): value is Polygon {
  if (
    !Array.isArray(value) ||
    value.length < 3 ||
    value.length > 100_000
  ) {
    return false;
  }

  return value.every(
    (point) =>
      record(point) &&
      typeof point.x === 'number' &&
      Number.isFinite(point.x) &&
      typeof point.y === 'number' &&
      Number.isFinite(point.y),
  );
}

function validateStoredContourPair(
  value: unknown,
): asserts value is StoredContourPair {
  if (
    !record(value) ||
    value.version !== 1 ||
    !isPolygon(value.fastPolygon) ||
    !isPolygon(value.finePolygon)
  ) {
    throw new Error('Contorno guardado inválido.');
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('IndexedDB no disponible.'));
      return;
    }

    const request = indexedDB.open(
      DB_NAME,
      DB_VERSION,
    );

    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(
        request.error ??
          new Error('No se pudo abrir el caché de contornos.'),
      );
    };

    request.onblocked = () => {
      reject(
        new Error(
          'Cerrá otras ventanas de Nestra para abrir el caché de contornos.',
        ),
      );
    };
  });
}

export async function loadCachedContourPair(
  key: string,
): Promise<CachedContourPair | undefined> {
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
          .get(key);

        request.onsuccess = () => {
          resolve(request.result);
        };

        request.onerror = () => {
          reject(request.error);
        };
      },
    );

    if (value === undefined) {
      return undefined;
    }

    validateStoredContourPair(value);

    return {
      fastPolygon: value.fastPolygon,
      finePolygon: value.finePolygon,
    };
  } finally {
    db.close();
  }
}

export async function saveCachedContourPair(
  key: string,
  value: CachedContourPair,
): Promise<void> {
  const stored: StoredContourPair = {
    version: 1,
    fastPolygon: value.fastPolygon,
    finePolygon: value.finePolygon,
  };

  validateStoredContourPair(stored);

  const db = await openDatabase();

  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(
        STORE,
        'readwrite',
      );

      transaction
        .objectStore(STORE)
        .put(stored, key);

      transaction.oncomplete = () => {
        resolve();
      };

      transaction.onerror = () => {
        reject(transaction.error);
      };

      transaction.onabort = () => {
        reject(
          transaction.error ??
            new Error('Guardado de contorno cancelado.'),
        );
      };
    });
  } finally {
    db.close();
  }
}