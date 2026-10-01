import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  buildDesignCollection,
  findCollectionPreviewAsset,
  isCollectionComplete,
  type DesignCollection,
} from './design-collection-state';
import { TrashIcon } from '../ui/trash-icon';
import { normalizeDesignName } from '../domain/order-import';
import { ImageLightbox } from './image-lightbox';
import { canImportBulkCandidate, scanBulkDesignFolders, type BulkDesignScan, type BulkDesignFolderInput } from './bulk-design-import';
import { discoverBulkDesignFolders, normalizeDesignSourcePath, type BulkDesignDiscovery, type DesignDirectory } from './bulk-design-discovery';
import { isRecognizableDesignAssetFilename } from '../domain/design-asset-filename';

const DESIGN_NAME_MAX_FONT_PX = 15;
const DESIGN_NAME_MIN_FONT_PX = 10;

export function fitCollectionNameFontSize(availableWidth: number, measuredTextWidth: number): number {
  if (availableWidth <= 0 || measuredTextWidth <= 0) return DESIGN_NAME_MAX_FONT_PX;
  return Math.min(
    DESIGN_NAME_MAX_FONT_PX,
    Math.max(DESIGN_NAME_MIN_FONT_PX, DESIGN_NAME_MAX_FONT_PX * (availableWidth * 2 / measuredTextWidth)),
  );
}

function AdaptiveDesignName({ name }: { readonly name: string }) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const measureRef = useRef<HTMLSpanElement | null>(null);
  const [fontSize, setFontSize] = useState(DESIGN_NAME_MAX_FONT_PX);

  useEffect(() => {
    let mounted = true;
    const update = () => {
      const availableWidth = headingRef.current?.clientWidth ?? 0;
      const textWidth = measureRef.current?.getBoundingClientRect().width ?? 0;
      if (!mounted) return;
      setFontSize(fitCollectionNameFontSize(availableWidth, textWidth));
    };
    update();
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(update);
    if (wrapperRef.current && observer) observer.observe(wrapperRef.current);
    if (!observer) window.addEventListener('resize', update);
    void document.fonts?.ready.then(update);
    return () => {
      mounted = false;
      observer?.disconnect();
      if (!observer) window.removeEventListener('resize', update);
    };
  }, [name]);

  return (
    <div className="design-collection-name-wrap" ref={wrapperRef}>
      <h3 ref={headingRef} title={name} style={{ fontSize: `${fontSize}px` }}>{name}</h3>
      <span ref={measureRef} className="design-collection-name-measure" aria-hidden="true">{name}</span>
    </div>
  );
}

interface DesignCollectionLibraryProps {
  readonly collections: readonly DesignCollection[];
  readonly onImport: (collection: DesignCollection) => void;
  readonly onImportMany?: (collections: readonly DesignCollection[]) => void | Promise<void>;
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
  const imageStyle = { width: '100%', height: 'auto', objectFit: 'contain' as const };
  return (
    <figure className="asset-preview">
      <figcaption>{label}</figcaption>
      {url ? (
        <ImageLightbox
          label={`Ampliar ${label}`}
          trigger={<img src={url} alt={label} loading="lazy" style={imageStyle} />}
          triggerStyle={{ width: '100%' }}
        >
          <img src={url} alt={label} />
        </ImageLightbox>
      ) : (
        <span className="collection-preview-placeholder">—</span>
      )}
    </figure>
  );
}

function LibraryReplacementAssets({ collection }: { readonly collection: DesignCollection }) {
  const [open, setOpen] = useState(false);
  const assets = collection.replacementAssets ?? [];
  if (!assets.length) return null;

  return (
    <details
      className="library-replacement-assets"
      onToggle={event => setOpen(event.currentTarget.open)}
    >
      <summary>Dorsos para reposición ({assets.length})</summary>
      {open ? (
        <div className="library-card-previews" aria-label={`Dorsos para reposición de ${collection.name}`}>
          {assets.map(asset => (
            <AssetPreview key={asset.relativePath} asset={asset} label={`${asset.size} · ${asset.fileName}`} />
          ))}
        </div>
      ) : null}
    </details>
  );
}

function possibleParentMix(collection: DesignCollection): string[] {
  const paths = [
    ...collection.assets.map(asset => asset.relativePath),
    ...(collection.replacementAssets ?? []).map(asset => asset.relativePath),
    ...(collection.masterAssets ?? []).map(asset => asset.relativePath),
  ];
  const foldersByParent = new Map<string, Map<string, string>>();
  const normalizedName = normalizeDesignName(collection.name);

  for (const path of paths) {
    const directories = path.replaceAll('\\', '/').split('/').filter(Boolean).slice(0, -1);
    if (directories.length < 3 || normalizeDesignName(directories[1] ?? '') !== normalizedName) continue;
    const parentKey = `${normalizeDesignName(directories[0] ?? '')}/${normalizedName}`;
    const childKey = normalizeDesignName(directories[2] ?? '');
    if (!childKey || childKey === normalizedName) continue;
    const children = foldersByParent.get(parentKey) ?? new Map<string, string>();
    children.set(childKey, directories[2] ?? childKey);
    foldersByParent.set(parentKey, children);
  }

  const mixedParent = [...foldersByParent.values()].find(children => children.size > 1);
  return mixedParent ? [...new Set(mixedParent.values())] : [];
}

function designNameFromFolderPath(path: string): string {
  return path.replace(/[\\/]+$/g, '').split(/[\\/]/).at(-1)?.trim() || 'Diseño importado';
}

function buildFolderCollection(files: readonly File[], id: string, path: string): DesignCollection {
  const collection = buildDesignCollection(files, id, path);
  return { ...collection, name: designNameFromFolderPath(path) };
}

function hasRecognizableCollectionAssets(collection: DesignCollection): boolean {
  return collection.assets.length + (collection.replacementAssets?.length ?? 0) + (collection.masterAssets?.length ?? 0) > 0;
}

function LibraryCollectionDiagnostics({ collection }: { readonly collection: DesignCollection }) {
  const duplicateSlots = [...new Set(collection.duplicateSlots)];
  const possibleChildren = possibleParentMix(collection);

  if (!duplicateSlots.length && !possibleChildren.length && !collection.missing.length) return null;

  return (
    <div className="library-card-diagnostics">
      {collection.missing.length ? (
        <details className="design-collection-warning-disclosure">
          <summary>Incompleto · faltan {collection.missing.length} piezas</summary>
          <div className="design-collection-warning-details">
            {collection.missing.map(asset => <span key={`${asset.size}-${asset.side}`}>{asset.size} {asset.side === 'front' ? 'Frente' : 'Dorso'}</span>)}
          </div>
        </details>
      ) : null}
      {duplicateSlots.length ? (
        <details className="design-collection-warning-disclosure">
          <summary>⚠ {duplicateSlots.length} slots duplicados</summary>
          <div className="design-collection-warning-details">
            {duplicateSlots.map(slot => <span key={slot}>{slot}</span>)}
          </div>
        </details>
      ) : null}
      {possibleChildren.length ? (
        <details className="design-collection-warning-disclosure">
          <summary>⚠ Revisar posible mezcla de subcarpetas</summary>
          <div className="design-collection-warning-details">
            <p>Hay assets guardados desde más de una subcarpeta. Reimportá cada carpeta de diseño correcta y revisá este registro antes de quitarlo.</p>
            <span>{possibleChildren.join(' · ')}</span>
          </div>
        </details>
      ) : null}
    </div>
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
  readonly ignoredFileCount: number;
}

interface SelectedDesignFolder {
  readonly path: string;
  readonly name: string;
}

interface BulkImportResultItem {
  readonly name: string;
  readonly status: 'importado' | 'actualizado' | 'omitido' | 'error';
  readonly details: readonly string[];
}

export function DesignCollectionLibrary({
  collections,
  onImport,
  onImportMany,
  onRemove,
  onUpdate,
}: DesignCollectionLibraryProps) {
  const [isImporting, setIsImporting] = useState(false);
  const [collectionPendingRemoval, setCollectionPendingRemoval] =
    useState<DesignCollection | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [bulkScan, setBulkScan] = useState<BulkDesignScan | null>(null);
  const [bulkDiscovery, setBulkDiscovery] = useState<BulkDesignDiscovery | null>(null);
  const [bulkProgress, setBulkProgress] = useState<string | null>(null);
  const [bulkResults, setBulkResults] = useState<readonly BulkImportResultItem[] | null>(null);
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [selectedBulkFolders, setSelectedBulkFolders] = useState<readonly SelectedDesignFolder[]>([]);
  const [bulkPickerError, setBulkPickerError] = useState<string | null>(null);

  function openBulkImport(): void {
    setBulkScan(null);
    setBulkDiscovery(null);
    setBulkResults(null);
    setBulkProgress(null);
    setSelectedBulkFolders([]);
    setBulkPickerError(null);
    setBulkDialogOpen(true);
  }

  async function addBulkFolders(): Promise<void> {
    if (isImporting) return;
    try {
      const paths = await invoke<string[] | null>('choose_design_folders');
      if (!paths?.length) return;
      setSelectedBulkFolders(current => {
        const known = new Set(current.map(folder => folder.path.replaceAll('/', '\\').replace(/[\\]+$/g, '').toLocaleLowerCase()));
        const additions = paths.flatMap(path => {
          const normalized = path.replaceAll('/', '\\').replace(/[\\]+$/g, '').toLocaleLowerCase();
          if (!normalized || known.has(normalized)) return [];
          known.add(normalized);
          return [{ path, name: path.replace(/[\\/]+$/g, '').split(/[\\/]/).at(-1) ?? path }];
        });
        return [...current, ...additions];
      });
    } catch (error) {
      setBulkPickerError(error instanceof Error ? error.message : 'No se pudo abrir el selector de carpetas.');
    }
  }

  async function analyzeBulkFolders(): Promise<void> {
    if (!selectedBulkFolders.length || isImporting) return;
    setIsImporting(true);
    setBulkScan(null);
    setBulkDiscovery(null);
    setBulkResults(null);
    setBulkPickerError(null);
    try {
      const discovery = await discoverBulkDesignFolders(selectedBulkFolders,
        path => invoke<DesignDirectory>('inspect_design_directory', { path }),
        (visited, queued) => setBulkProgress(`Escaneando carpetas… ${visited} recorridas · ${queued} pendientes`));
      setBulkDiscovery(discovery);
      const discoveredPaths = new Set(discovery.directories.map(folder => normalizeDesignSourcePath(folder.path)));
      const sourcePathsToCheck = [...new Set(collections.flatMap(collection => collection.sourceFolderPath && !discoveredPaths.has(normalizeDesignSourcePath(collection.sourceFolderPath)) ? [collection.sourceFolderPath] : []))];
      const missingSourcePaths = new Set<string>();
      if (sourcePathsToCheck.length) {
        const statuses = await invoke<{ path: string; missing: boolean }[]>('design_source_paths_status', { paths: sourcePathsToCheck });
        statuses.filter(status => status.missing).forEach(status => missingSourcePaths.add(normalizeDesignSourcePath(status.path)));
      }
      async function* readFolders(): AsyncGenerator<BulkDesignFolderInput> {
        for (const folder of discovery.designFolders) {
          try {
            const fileNames = folder.pngFileNames.filter(isRecognizableDesignAssetFilename);
            const selection = await invoke<NativeDesignFolderSelection>('read_design_folder_direct_from_path', { path: folder.path, fileNames });
            const files = selection.files.map(entry => {
              const file = new File([new Uint8Array(entry.bytes)], entry.fileName, { type: 'image/png' });
              Object.defineProperty(file, 'webkitRelativePath', { value: entry.relativePath });
              return file;
            });
            yield { path: folder.path, name: folder.name, files, ignoredFileCount: selection.ignoredFileCount,
              directFileCount: folder.directFileCount, parserIgnoredFileNames: folder.pngFileNames.filter(name => !isRecognizableDesignAssetFilename(name)) };
          } catch (error) {
            yield { path: folder.path, name: folder.name, files: [], readError: error instanceof Error ? error.message : 'No se pudo leer esta carpeta.' };
          }
        }
      }
      const scan = await scanBulkDesignFolders(readFolders(), collections, completed => {
        setBulkProgress(`Analizando diseños… ${completed}/${discovery.designFolders.length}`);
      }, discovery.designFolders.length, missingSourcePaths, false);
      setBulkScan(scan);
    } catch (error) {
      setBulkResults([{ name: 'Análisis', status: 'error', details: [error instanceof Error ? error.message : 'No se pudieron analizar las carpetas.'] }]);
    } finally {
      setBulkProgress(null);
      setIsImporting(false);
    }
  }

  async function confirmBulkImport(): Promise<void> {
    if (!bulkScan || isImporting) return;
    setIsImporting(true);
    const results: BulkImportResultItem[] = [];
    const staged = new Map<number, DesignCollection>();
    const candidates = bulkScan.candidates;
    for (const candidate of candidates) {
      if (!candidate.collection) {
        results.push({ name: candidate.name, status: candidate.errors.length ? 'error' : 'omitido', details: [...candidate.errors, ...candidate.warnings] });
      } else if (candidate.conflict === 'duplicate-slot') {
        results.push({
          name: candidate.name,
          status: 'error',
          details: [...candidate.errors, 'Hay slots canónicos duplicados; no se importó ni actualizó el diseño.', ...candidate.warnings],
        });
      } else if (candidate.conflict === 'ambiguous' || candidate.conflict === 'duplicate') {
        results.push({
          name: candidate.name,
          status: 'error',
          details: [...candidate.errors, candidate.conflict === 'ambiguous' ? 'Hay varias colecciones equivalentes en Biblioteca; no se modificó ninguna.' : 'La selección contiene más de una carpeta de diseño con el mismo nombre; corregí la estructura antes de importar.', ...candidate.warnings],
        });
      } else {
        try {
          let collection = candidate.collection;
          if (candidate.deferredFiles) {
            setBulkProgress(`Preparando importación… ${results.length + 1}/${candidates.length} · ${candidate.name}`);
            const directory = await invoke<DesignDirectory>('inspect_design_directory', { path: candidate.path });
            const fileNames = directory.pngFileNames.filter(isRecognizableDesignAssetFilename);
            const selection = await invoke<NativeDesignFolderSelection>('read_design_folder_direct_from_path', { path: candidate.path, fileNames });
            const files = selection.files.map(entry => {
              const file = new File([new Uint8Array(entry.bytes)], entry.fileName, { type: 'image/png' });
              Object.defineProperty(file, 'webkitRelativePath', { value: entry.relativePath });
              return file;
            });
            const fresh = (await scanBulkDesignFolders([{ path: candidate.path, name: directory.name, files,
              ignoredFileCount: selection.ignoredFileCount, directFileCount: directory.directFileCount,
              parserIgnoredFileNames: directory.pngFileNames.filter(name => !isRecognizableDesignAssetFilename(name)) }], [])).candidates[0];
            if (!fresh || !canImportBulkCandidate(fresh) || JSON.stringify(fresh.sourceFileNames) !== JSON.stringify(candidate.sourceFileNames)) {
              throw new Error('La carpeta cambió o tiene un conflicto desde el análisis. Volvé a analizarla antes de importar.');
            }
            collection = fresh.collection!;
          }
          staged.set(results.length, { ...collection, id: candidate.existingId ?? candidate.collection.id });
          results.push({ name: candidate.name, status: candidate.existingId ? 'actualizado' : 'importado', details: [...candidate.errors, ...candidate.warnings] });
        } catch (error) {
          results.push({ name: candidate.name, status: 'error', details: [error instanceof Error ? error.message : String(error)] });
        }
      }
    }
    if (onImportMany && staged.size) {
      const label = staged.size === 1 ? 'diseño' : 'diseños';
      setBulkProgress(`Guardando ${staged.size} ${label} en Biblioteca…`);
      await new Promise<void>(resolve => window.setTimeout(resolve, 0));
      try {
        await onImportMany([...staged.values()]);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'No se pudieron guardar los diseños.';
        for (const index of staged.keys()) {
          const result = results[index]!;
          results[index] = { ...result, status: 'error', details: [...result.details, message] };
        }
      }
    } else if (!onImportMany) {
      for (const [index, collection] of staged) {
        try {
          onImport(collection);
        } catch (error) {
          const result = results[index]!;
          results[index] = { ...result, status: 'error', details: [...result.details, error instanceof Error ? error.message : 'No se pudo guardar este diseño.'] };
        }
      }
    }
    setBulkResults(results);
    setBulkProgress(null);
    setIsImporting(false);
  }

  function closeBulkImport(): void {
    if (isImporting) return;
    setBulkScan(null);
    setBulkDiscovery(null);
    setBulkResults(null);
    setBulkProgress(null);
    setSelectedBulkFolders([]);
    setBulkPickerError(null);
    setBulkDialogOpen(false);
  }

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
      const updated = buildFolderCollection(files, collection.id, collection.sourceFolderPath);
      if (!hasRecognizableCollectionAssets(updated)) throw new Error('La carpeta no tiene assets directos reconocibles; no se reemplazó la colección guardada.');
      onUpdate(updated);
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

      const collection = buildFolderCollection(
        files,
        crypto.randomUUID(),
        selection.sourceFolderPath,
      );

      if (!hasRecognizableCollectionAssets(collection)) {
        window.alert('La carpeta elegida no contiene assets PNG directos reconocibles. Seleccioná la carpeta real del diseño.');
        return;
      }

      onImport(collection);
    } catch (error) {
      window.alert(`No se pudo importar la carpeta.\n${String(error)}`);
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <section className="design-collection-library">
      <div className="design-collection-header">
        <div>
          <h2>Diseños de Biblioteca</h2>
          <p className="muted">
            Seleccioná carpetas de diseños o carpetas que las contengan.
          </p>
        </div>

        {collections.length > 0 ? (
          <button
            type="button"
            className="secondary-button design-folder-button"
            disabled={isImporting}
            onClick={() => void handleNativeFolderImport()}
          >
            {isImporting ? 'Importando…' : 'Importar carpeta de diseño'}
          </button>
        ) : null}
        <button
          type="button"
          className="secondary-button design-folder-button"
          disabled={isImporting}
          onClick={openBulkImport}
        >
          Importar diseños
        </button>
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
            {isImporting ? 'Importando…' : 'Importar carpeta de diseño'}
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
                    <AdaptiveDesignName name={collection.name} />
                    <p className="muted design-collection-card-metadata">{complete ? 'T1–T10 · ✓' : 'T1–T10 · incompleto'}</p>

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

                  <LibraryReplacementAssets collection={collection} />
                  <LibraryCollectionDiagnostics collection={collection} />
                </article>
              );
            })}
        </div>
      )}
      {bulkDialogOpen ? (
        <div className="confirm-backdrop bulk-design-backdrop" role="presentation" onMouseDown={closeBulkImport}>
          <section className="confirm-dialog bulk-design-dialog" role="dialog" aria-modal="true" aria-labelledby="bulk-design-title" onMouseDown={event => event.stopPropagation()}>
            <h2 id="bulk-design-title">Importar diseños</h2>
            {bulkProgress ? <p className="bulk-design-progress" role="status">{bulkProgress}</p> : null}
            {bulkPickerError ? <p className="bulk-design-error" role="alert">{bulkPickerError}</p> : null}
            {!bulkScan && bulkResults ? (
              <div className="bulk-design-results" role="alert">
                <strong>No se pudo completar la operación</strong>
                {bulkResults.map((result, index) => <p key={`${result.name}-${index}`}>{result.details.join(' ')}</p>)}
              </div>
            ) : null}
            {!bulkScan && !bulkResults ? (
              <>
                <div className="bulk-design-selected-heading">{selectedBulkFolders.length} carpetas seleccionadas</div>
                <p className="bulk-design-folder-rule">Seleccioná carpetas de diseños o carpetas que las contengan. Cada diseño usa sólo los archivos de su propia carpeta.</p>
                <div className="bulk-design-selected-folders" aria-label="Carpetas seleccionadas">
                  {selectedBulkFolders.map((folder, index) => (
                    <div className="bulk-design-selected-folder" key={folder.path} title={folder.path}>
                      <span>{folder.name}</span>
                      <button type="button" aria-label={`Quitar ${folder.name}`} disabled={isImporting} onClick={() => setSelectedBulkFolders(current => current.filter((_, itemIndex) => itemIndex !== index))}>×</button>
                    </div>
                  ))}
                  {!selectedBulkFolders.length ? <p>Se recorren todos sus descendientes para encontrar diseños.</p> : null}
                </div>
              </>
            ) : null}
            {bulkScan ? (
              <>
                <div className="bulk-design-summary">
                  <span>{bulkScan.candidates.length} diseños encontrados</span>
                  <span>{bulkDiscovery?.directoriesVisited ?? 0} carpetas recorridas</span>
                  <span>{bulkScan.completeCount} completos</span>
                  <span>{bulkScan.incompleteCount} incompletos</span>
                  <span>{bulkScan.conflictCount} conflictos</span>
                  <span>{bulkDiscovery?.noAssetsCount ?? bulkScan.noAssetsCount} sin assets</span>
                  <span>{bulkScan.recognizedCount} archivos reconocidos</span>
                  <span>{bulkScan.filesIgnored} ignorados</span>
                </div>
                {bulkDiscovery?.errors.map(error => <p className="bulk-design-error" key={error.path}>{error.path}: {error.message}</p>)}
                {bulkDiscovery?.skippedLinkPaths.length ? <p>{bulkDiscovery.skippedLinkPaths.length} enlaces/junctions omitidos.</p> : null}
                {bulkScan.candidates.length ? (
                  <div className="bulk-design-candidates">
                    {bulkScan.candidates.map((candidate, index) => (
                      <article className="bulk-design-candidate" key={`${candidate.name}-${index}`}>
                        <div>
                          <strong>{candidate.name}</strong>
                          <small title={candidate.path}>{candidate.path}</small>
                          <span>{candidate.filesRecognized} reconocidos · {candidate.filesIgnored} ignorados</span>
                        </div>
                        <span className={`bulk-design-conflict bulk-design-conflict--${candidate.conflict}`}>
                          {candidate.conflict === 'update' ? 'Actualizar existente' : candidate.conflict === 'new' ? 'Nuevo diseño' : candidate.conflict === 'duplicate' ? 'Nombre duplicado' : candidate.conflict === 'duplicate-slot' ? 'Slots duplicados' : candidate.conflict === 'incomplete' ? `Incompleto · se ${candidate.existingId ? 'actualizará' : 'importará'}` : candidate.conflict === 'no-assets' ? 'Sin assets reconocibles' : candidate.conflict === 'read-error' ? 'No se pudo leer' : 'Conflicto ambiguo'}
                        </span>
                        {[...candidate.errors, ...candidate.warnings].length ? (
                          <details className="bulk-design-candidate-details">
                            <summary>Ver detalles ({candidate.errors.length + candidate.warnings.length})</summary>
                            {[...candidate.errors, ...candidate.warnings].map((message, messageIndex) => <p className={candidate.errors.includes(message) ? 'bulk-design-error' : 'bulk-design-warning'} key={`${messageIndex}-${message}`}>{message}</p>)}
                          </details>
                        ) : null}
                      </article>
                    ))}
                  </div>
                ) : <p>No hay carpetas para analizar.</p>}
                {bulkResults ? (
                  <div className="bulk-design-results" role="status">
                    <strong>Importación terminada</strong>
                    <span>{bulkResults.filter(result => result.status === 'importado').length} importados · {bulkResults.filter(result => result.status === 'actualizado').length} actualizados · {bulkResults.filter(result => result.status === 'omitido').length} omitidos · {bulkResults.filter(result => result.status === 'error').length} errores</span>
                    <div className="bulk-design-result-list">
                      {bulkResults.map((result, index) => (
                        <details key={`${result.name}-${index}`}>
                          <summary><b>{result.status.toUpperCase()}</b> · {result.name}</summary>
                          {result.details.map((detail, detailIndex) => <p key={`${detailIndex}-${detail}`}>{detail}</p>)}
                        </details>
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}
            <div className="confirm-dialog-actions">
              {bulkScan && bulkResults ? (
                <button type="button" className="confirm-cancel-button" onClick={closeBulkImport}>CERRAR</button>
              ) : bulkScan ? (
                <>
                  <button type="button" className="confirm-cancel-button" disabled={isImporting} onClick={closeBulkImport}>CANCELAR</button>
                  <button type="button" className="batch-primary-button" disabled={isImporting || !bulkScan.candidates.some(canImportBulkCandidate)} onClick={() => void confirmBulkImport()}>
                    {(() => {
                      const count = bulkScan.candidates.filter(canImportBulkCandidate).length;
                      return `Importar ${count} ${count === 1 ? 'diseño' : 'diseños'}`;
                    })()}
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="confirm-cancel-button" disabled={isImporting} onClick={closeBulkImport}>CANCELAR</button>
                  <button type="button" className="secondary-button" disabled={isImporting} onClick={() => void addBulkFolders()}>Agregar carpetas</button>
                  <button type="button" className="batch-primary-button" disabled={isImporting || !selectedBulkFolders.length} onClick={() => void analyzeBulkFolders()}>Analizar diseños</button>
                </>
              )}
            </div>
          </section>
        </div>
      ) : null}
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
