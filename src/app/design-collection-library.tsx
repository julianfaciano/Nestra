import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  buildDesignCollection,
  findCollectionPreviewAsset,
  isCollectionComplete,
  type DesignCollection,
} from './design-collection-state';
import { TrashIcon } from '../ui/trash-icon';
import { ImageLightbox } from './image-lightbox';

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
  return (
    <figure className="asset-preview">
      <figcaption>{label}</figcaption>
      {url ? (
        <ImageLightbox
          label={`Ampliar ${label}`}
          trigger={<img src={url} alt={label} />}
        >
          <img src={url} alt={label} />
        </ImageLightbox>
      ) : (
        <span className="collection-preview-placeholder">—</span>
      )}
    </figure>
  );
}

function ReloadIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M15.6 6.3A6.2 6.2 0 1 0 16 13" />
      <path d="M15.6 2.8v3.5h-3.5" />
    </svg>
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

        {collections.length > 0 ? (
          <button
            type="button"
            className="secondary-button design-folder-button"
            disabled={isImporting}
            onClick={() => void handleNativeFolderImport()}
          >
            {isImporting ? 'Importando…' : 'Importar colección'}
          </button>
        ) : null}
      </div>

      {collections.length === 0 ? (
        <div className="design-collection-empty empty-state">
          <span className="status-badge">BIBLIOTECA VACÍA</span>
          <h2>Todavía no hay diseños</h2>
          <p>Importá tu primera colección para empezar a producir.</p>
          <button
            type="button"
            className="primary-button"
            disabled={isImporting}
            onClick={() => void handleNativeFolderImport()}
          >
            {isImporting ? 'Importando…' : 'Importar colección'}
          </button>
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
                  <div className="library-card-previews">
                    {(['front', 'back'] as const).map((side) => (
                      <AssetPreview
                        key={side}
                        asset={findCollectionPreviewAsset(collection, side)}
                        label={side === 'front' ? 'Frente' : 'Dorso'}
                      />
                    ))}
                  </div>

                  <div className="design-collection-card-header">
                    <div>
                      <h3>{collection.name}</h3>

                      <p className="muted">T1–T10 · frente y dorso</p>
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
                        <ReloadIcon />
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
