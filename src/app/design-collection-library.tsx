import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  buildDesignCollection,
  findCollectionAsset,
  findCollectionPreviewAsset,
  isCollectionComplete,
  type DesignCollection,
} from './design-collection-state';
import { GARMENT_SIZES } from '../domain/size';
import { TrashIcon } from '../ui/trash-icon';

interface DesignCollectionLibraryProps {
  readonly collections: readonly DesignCollection[];
  readonly onImport: (collection: DesignCollection) => void;
  readonly onRemove: (id: string) => void;
  readonly onUpdate: (collection: DesignCollection) => void;
}

export function AssetPreview({
  asset,
  label,
}: {
  asset: { readonly file: File } | undefined;
  label: string;
}) {
  const [url, setUrl] = useState<string>();
  // URL ownership is local to this component; cleanup never touches another preview.
  useEffect(() => {
    if (!asset) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUrl(undefined);
      return;
    }
    const next = URL.createObjectURL(asset.file);
    setUrl(next);
    return () => {
      URL.revokeObjectURL(next);
      setUrl((current) => (current === next ? undefined : current));
    };
  }, [asset]);
  return url ? (
    <img src={url} alt={label} />
  ) : (
    <span className="collection-preview-placeholder">—</span>
  );
}

interface NativeDesignFolderFile {
  readonly fileName: string;
  readonly relativePath: string;
  readonly bytes: readonly number[];
}

interface NativeDesignFolderSelection {
  readonly sourceFolderPath: string;
  readonly files: readonly NativeDesignFolderFile[];
}

export function DesignCollectionLibrary({
  collections,
  onImport,
  onRemove,
  onUpdate,
}: DesignCollectionLibraryProps) {
  const [isImporting, setIsImporting] = useState(false);
  const [collectionPendingRemoval, setCollectionPendingRemoval] =
    useState<DesignCollection | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  async function handleUpdate(collection: DesignCollection): Promise<void> {
    if (!collection.sourceFolderPath || updatingId) return;
    setUpdatingId(collection.id);
    try {
      const selection = await invoke<
        NativeDesignFolderSelection & { sourceFolderPath: string }
      >('read_design_folder_from_path', { path: collection.sourceFolderPath });
      const files = selection.files.map((entry) => {
        const file = new File([new Uint8Array(entry.bytes)], entry.fileName, {
          type: 'image/png',
        });
        Object.defineProperty(file, 'webkitRelativePath', {
          value: entry.relativePath,
        });
        return file;
      });
      onUpdate(
        buildDesignCollection(
          files,
          collection.id,
          collection.sourceFolderPath,
        ),
      );
    } catch (error) {
      window.alert(
        `No se pudo actualizar la carpeta.\nLos archivos anteriores se conservaron.\n${String(error)}`,
      );
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleNativeFolderImport(): Promise<void> {
    if (isImporting) {
      return;
    }

    setIsImporting(true);

    try {
      const selection = await invoke<NativeDesignFolderSelection | null>(
        'choose_design_folder',
      );

      if (!selection) {
        return;
      }

      const files: File[] = [];

      for (const entry of selection.files) {
        const file = new File([new Uint8Array(entry.bytes)], entry.fileName, {
          type: 'image/png',
        });

        Object.defineProperty(file, 'webkitRelativePath', {
          value: entry.relativePath,
        });

        files.push(file);

        /*
         * Cedemos brevemente el hilo de UI para evitar reconstruir
         * todos los PNG en un único bloque largo.
         */
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 0);
        });
      }

      const collection = buildDesignCollection(
        files,
        crypto.randomUUID(),
        selection.sourceFolderPath,
      );

      onImport(collection);
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <section className="design-collection-library">
      <div className="design-collection-header">
        <div>
          <h2>Diseños completos</h2>
          <p className="muted">
            Importá una carpeta con los frentes y dorsos de T1 a T10.
          </p>
        </div>

        <button
          type="button"
          className="secondary-button design-folder-button"
          disabled={isImporting}
          onClick={() => void handleNativeFolderImport()}
        >
          {isImporting ? 'IMPORTANDO...' : 'IMPORTAR CARPETA DE DISEÑO'}
        </button>
      </div>

      {collections.length === 0 ? (
        <div className="design-collection-empty">
          Todavía no importaste ningún diseño completo.
        </div>
      ) : (
        <div className="design-collection-grid">
          {[...collections]
            .sort((a, b) =>
              a.name.localeCompare(b.name, 'es', {
                sensitivity: 'base',
                numeric: true,
              }),
            )
            .map((collection) => {
              const complete = isCollectionComplete(collection);

              return (
                <article key={collection.id} className="design-collection-card">
                  <div className="design-collection-card-header">
                    <div>
                      <h3>{collection.name}</h3>

                      <p className="muted">
                        {
                          GARMENT_SIZES.filter(
                            (size) =>
                              findCollectionAsset(collection, size, 'front') &&
                              findCollectionAsset(collection, size, 'back'),
                          ).length
                        }{' '}
                        / 10 talles
                        {complete ? ' ✓' : ''}
                      </p>
                    </div>

                    <div className="design-collection-card-actions">
                      {!complete ? (
                        <span
                          className="collection-error"
                          title="La colección está incompleta: faltan talles o lados (Frente/Dorso)."
                          aria-label="La colección está incompleta"
                        >
                          ⚠
                        </span>
                      ) : null}

                      <button
                        type="button"
                        className="library-sync-button"
                        onClick={() => void handleUpdate(collection)}
                        disabled={
                          !collection.sourceFolderPath || updatingId !== null
                        }
                        title={
                          collection.sourceFolderPath
                            ? 'Actualizar desde carpeta'
                            : 'Carpeta original no disponible'
                        }
                        aria-label={
                          collection.sourceFolderPath
                            ? `Actualizar ${collection.name} desde carpeta`
                            : 'Carpeta original no disponible'
                        }
                      >
                        ↻
                      </button>

                      <button
                        type="button"
                        className="batch-remove-button"
                        onClick={() => setCollectionPendingRemoval(collection)}
                        aria-label={`Eliminar ${collection.name}`}
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </div>

                  <div className="library-card-previews">
                    {(['front', 'back'] as const).map((side) => (
                      <AssetPreview
                        key={side}
                        asset={findCollectionPreviewAsset(collection, side)}
                        label={side === 'front' ? 'Frente' : 'Dorso'}
                      />
                    ))}
                  </div>

                  {collection.duplicateSlots.length > 0 ? (
                    <p className="design-collection-warning">
                      Hay archivos duplicados para:{' '}
                      {collection.duplicateSlots.join(', ')}
                    </p>
                  ) : null}
                </article>
              );
            })}
        </div>
      )}
      {collectionPendingRemoval ? (
        <div
          className="confirm-backdrop"
          role="presentation"
          onMouseDown={() => setCollectionPendingRemoval(null)}
        >
          <div
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-design-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h3 id="remove-design-title">Eliminar diseño</h3>

            <p>
              ¿Querés eliminar "{collectionPendingRemoval.name}" de la
              Biblioteca?
            </p>

            <div className="confirm-dialog-actions">
              <button
                type="button"
                className="confirm-cancel-button"
                onClick={() => setCollectionPendingRemoval(null)}
              >
                CANCELAR
              </button>

              <button
                type="button"
                className="confirm-delete-button"
                onClick={() => {
                  onRemove(collectionPendingRemoval.id);
                  setCollectionPendingRemoval(null);
                }}
              >
                ELIMINAR
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
