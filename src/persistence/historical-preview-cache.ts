const DB_NAME = 'nestra-historical-previews';
const DB_VERSION = 1;
const STORE = 'previews';

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
      if (
        !request.result.objectStoreNames.contains(
          STORE,
        )
      ) {
        request.result.createObjectStore(STORE);
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(
        request.error ??
          new Error(
            'No se pudo abrir el caché de previews.',
          ),
      );
    };

    request.onblocked = () => {
      reject(
        new Error(
          'Cerrá otras ventanas de Nestra para actualizar el caché.',
        ),
      );
    };
  });
}

export async function saveHistoricalPreview(
  key: string,
  blob: Blob,
): Promise<void> {
  const db = await openDatabase();

  try {
    await new Promise<void>(
      (resolve, reject) => {
        const transaction = db.transaction(
          STORE,
          'readwrite',
        );

        transaction
          .objectStore(STORE)
          .put(blob, key);

        transaction.oncomplete = () =>
          resolve();

        transaction.onerror = () =>
          reject(
            transaction.error ??
              new Error(
                'No se pudo guardar el preview.',
              ),
          );

        transaction.onabort = () =>
          reject(
            transaction.error ??
              new Error(
                'Se canceló el guardado del preview.',
              ),
          );
      },
    );
  } finally {
    db.close();
  }
}

export async function loadHistoricalPreview(
  key: string,
): Promise<Blob | null> {
  const db = await openDatabase();

  try {
    const value: unknown =
      await new Promise(
        (resolve, reject) => {
          const transaction =
            db.transaction(
              STORE,
              'readonly',
            );

          const request = transaction
            .objectStore(STORE)
            .get(key);

          request.onsuccess = () =>
            resolve(request.result);

          request.onerror = () =>
            reject(
              request.error ??
                new Error(
                  'No se pudo leer el preview.',
                ),
            );
        },
      );

    return value instanceof Blob
      ? value
      : null;
  } finally {
    db.close();
  }
}

export async function deleteHistoricalPreview(
  key: string,
): Promise<void> {
  const db = await openDatabase();

  try {
    await new Promise<void>(
      (resolve, reject) => {
        const transaction = db.transaction(
          STORE,
          'readwrite',
        );

        transaction
          .objectStore(STORE)
          .delete(key);

        transaction.oncomplete = () =>
          resolve();

        transaction.onerror = () =>
          reject(
            transaction.error ??
              new Error(
                'No se pudo eliminar el preview.',
              ),
          );

        transaction.onabort = () =>
          reject(
            transaction.error ??
              new Error(
                'Se canceló la eliminación del preview.',
              ),
          );
      },
    );
  } finally {
    db.close();
  }
}