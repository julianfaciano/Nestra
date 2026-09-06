import { useEffect, useMemo, useRef, useState } from 'react';
import { useTemplateLibrary } from './use-template-library';
import { useDesignCollections } from './use-design-collections';
import nestraLogo from '../assets/logo.png';
import nestraWordmark from '../assets/nestra-wordmark.png';
import { SplashScreen } from './splash-screen';
import {
  DEFAULT_ALPHA_THRESHOLD,
  clampAlphaThreshold,
} from '../geometry/alpha-contour';
import {
  PIECE_SIDES,
  getPieceSideLabel,
  type PieceSide,
} from '../domain/piece-side';
import { GARMENT_SIZES, type GarmentSize } from '../domain/size';
import { AlphaContourPreview } from './alpha-contour-preview';
import type { SizeTemplateDraft } from './size-template-state';
import { GeometryPlayground } from './geometry-playground';
import { NestingPreview } from './nesting-preview';
import { BatchPage } from './batch-page';
import { physicalSizeFromSourcePixels } from '../domain/source-image-size';
import { DesignCollectionLibrary } from './design-collection-library';
import type { DesignCollection } from './design-collection-state';
import { HistoricalJobs } from './historical-jobs';

type View = 'home' | 'templates' | 'batch' | 'jobs';

function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);
  const [matchCount, setMatchCount] = useState(0);
  const [navigationTick, setNavigationTick] = useState(0);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const rangesRef = useRef<Range[]>([]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setOpen(true);

        requestAnimationFrame(() => {
          inputRef.current?.focus();
          inputRef.current?.select();
        });

        return;
      }

      if (event.key === 'Escape' && open) {
        event.preventDefault();
        closeSearch();
      }
    };

    window.addEventListener('keydown', handler);

    return () => {
      window.removeEventListener('keydown', handler);
    };
  }, [open]);

  useEffect(() => {
    const globals = globalThis as typeof globalThis & {
      CSS?: {
        highlights?: {
          set: (name: string, highlight: unknown) => void;
          delete: (name: string) => void;
        };
      };
      Highlight?: new (...ranges: Range[]) => unknown;
    };

    const registry = globals.CSS?.highlights;
    const HighlightConstructor = globals.Highlight;

    registry?.delete('nestra-find');
    registry?.delete('nestra-find-current');

    rangesRef.current = [];
    setMatchCount(0);
    setMatchIndex(0);

    if (!open || query.length === 0) {
      return;
    }

    const needle = query.toLocaleLowerCase();
    const ranges: Range[] = [];

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );

    let node: Node | null;

    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      const textContent = node.textContent;

      if (!parent || !textContent) {
        continue;
      }

      if (
        parent.closest('.global-search') ||
        parent.closest('[hidden]') ||
        parent.closest('script, style, noscript, textarea')
      ) {
        continue;
      }

      const text = textContent.toLocaleLowerCase();
      let from = 0;

      while (from < text.length) {
        const found = text.indexOf(needle, from);

        if (found === -1) {
          break;
        }

        const range = document.createRange();

        range.setStart(node, found);
        range.setEnd(node, found + query.length);

        ranges.push(range);

        from = found + Math.max(query.length, 1);
      }
    }

    rangesRef.current = ranges;
    setMatchCount(ranges.length);

    if (registry && HighlightConstructor && ranges.length > 0) {
      registry.set('nestra-find', new HighlightConstructor(...ranges));
    }

    return () => {
      registry?.delete('nestra-find');
      registry?.delete('nestra-find-current');
    };
  }, [open, query]);

  useEffect(() => {
    const globals = globalThis as typeof globalThis & {
      CSS?: {
        highlights?: {
          set: (name: string, highlight: unknown) => void;
          delete: (name: string) => void;
        };
      };
      Highlight?: new (...ranges: Range[]) => unknown;
    };

    const registry = globals.CSS?.highlights;
    const HighlightConstructor = globals.Highlight;

    registry?.delete('nestra-find-current');

    if (!open || matchCount === 0 || !rangesRef.current[matchIndex]) {
      return;
    }

    const currentRange = rangesRef.current[matchIndex];

    if (registry && HighlightConstructor) {
      registry.set(
        'nestra-find-current',
        new HighlightConstructor(currentRange),
      );
    }

    currentRange.startContainer.parentElement?.scrollIntoView({
      block: 'center',
      inline: 'nearest',
      behavior: 'smooth',
    });
  }, [open, matchCount, matchIndex, navigationTick]);

  function closeSearch(): void {
    setOpen(false);
    setQuery('');
    setMatchIndex(0);
    setMatchCount(0);
    rangesRef.current = [];

    const globals = globalThis as typeof globalThis & {
      CSS?: {
        highlights?: {
          delete: (name: string) => void;
        };
      };
    };

    globals.CSS?.highlights?.delete('nestra-find');
    globals.CSS?.highlights?.delete('nestra-find-current');
  }

  function moveMatch(direction: 1 | -1): void {
    if (matchCount === 0) {
      return;
    }

    setMatchIndex((current) => (current + direction + matchCount) % matchCount);

    setNavigationTick((current) => current + 1);
  }

  if (!open) {
    return null;
  }

  return (
    <div className="global-search" role="search">
      <input
        ref={inputRef}
        value={query}
        placeholder="Buscar"
        aria-label="Buscar"
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => {
          setQuery(event.target.value);
          setMatchIndex(0);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            moveMatch(event.shiftKey ? -1 : 1);
          }
        }}
      />

      <span className="find-count">
        {query.length > 0
          ? `${matchCount > 0 ? matchIndex + 1 : 0}/${matchCount}`
          : '0/0'}
      </span>

      <button
        type="button"
        aria-label="Coincidencia anterior"
        disabled={matchCount === 0}
        onClick={() => moveMatch(-1)}
      >
        ↑
      </button>

      <button
        type="button"
        aria-label="Coincidencia siguiente"
        disabled={matchCount === 0}
        onClick={() => moveMatch(1)}
      >
        ↓
      </button>

      <button
        type="button"
        className="global-search-close"
        aria-label="Cerrar búsqueda"
        title="Cerrar"
        onClick={closeSearch}
      >
        ×
      </button>
    </div>
  );
}

function CompactLibrary({
  collections,
  onImport,
  onRemove,
  onUpdate,
}: {
  collections: readonly DesignCollection[];
  onImport: (collection: DesignCollection) => void;
  onRemove: (id: string) => void;
  onUpdate: (collection: DesignCollection) => void;
}) {
  return (
    <section className="library-page">
      <div className="page-header">
        <div>
          <h1>Biblioteca de diseños</h1>
        </div>
        <span className="template-progress">
          {collections.length}{' '}
          {collections.length === 1 ? 'diseño importado' : 'diseños importados'}
        </span>
      </div>
      <DesignCollectionLibrary
        collections={collections}
        onImport={onImport}
        onRemove={onRemove}
        onUpdate={onUpdate}
      />
    </section>
  );
}

interface SelectedSlot {
  readonly size: GarmentSize;
  readonly side: PieceSide;
}

export default function App() {
  const [view, setView] = useState<View>('home');

  const [showSplash, setShowSplash] = useState(true);

  const [splashExiting, setSplashExiting] = useState(false);
  const {
    collections,
    setCollections,
    status: collectionsStatus,
  } = useDesignCollections();
  const {
    templates,
    setTemplates,
    ready,
    status: libraryStatus,
  } = useTemplateLibrary();
  const [importStatus, setImportStatus] = useState('');
  const importVersions = useRef(new Map<string, number>());
  const [selected, setSelected] = useState<SelectedSlot>({
    size: 'T8',
    side: 'front',
  });

  useEffect(() => {
    /*
     * El splash permanece visible al menos
     * 1,1 segundos y luego inicia una salida
     * suave de 280 ms.
     */
    const exitTimer = window.setTimeout(() => {
      setSplashExiting(true);
    }, 1100);

    const hideTimer = window.setTimeout(() => {
      setShowSplash(false);
    }, 1380);

    return () => {
      window.clearTimeout(exitTimer);
      window.clearTimeout(hideTimer);
    };
  }, []);

  const selectedTemplate = useMemo(
    () =>
      templates.find(
        (template) =>
          template.size === selected.size && template.side === selected.side,
      ),
    [templates, selected],
  );

  const selectedAlphaThreshold =
    selectedTemplate?.alphaThreshold ?? DEFAULT_ALPHA_THRESHOLD;

  const selectedSimplificationTolerance =
    selectedTemplate?.simplificationTolerancePx ?? 1.5;

  function importDesignCollection(collection: DesignCollection): void {
    setCollections((current) => {
      /*
       * Si volvemos a importar una carpeta con el mismo nombre,
       * reemplazamos la colección anterior.
       */
      const withoutSameName = current.filter(
        (item) => item.name.toLowerCase() !== collection.name.toLowerCase(),
      );

      return [...withoutSameName, collection];
    });
  }

  function removeDesignCollection(id: string): void {
    setCollections((current) =>
      current.filter((collection) => collection.id !== id),
    );
  }

  function updateSelectedTemplate(
    patch: Partial<SizeTemplateDraft>,
    slot = selected,
  ): void {
    setTemplates((current) => {
      const index = current.findIndex(
        (template) =>
          template.size === slot.size && template.side === slot.side,
      );

      const existing = index === -1 ? undefined : current[index];

      const next: SizeTemplateDraft = {
        size: slot.size,
        side: slot.side,
        ...(existing ?? {}),
        ...patch,
      };

      if (index === -1) {
        return [...current, next];
      }

      return current.map((template, templateIndex) =>
        templateIndex === index ? next : template,
      );
    });
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (file.type !== 'image/png') {
      window.alert('Seleccioná un archivo PNG.');
      event.target.value = '';
      return;
    }

    if (file.size > 32 * 1024 * 1024) {
      setImportStatus('PNG demasiado grande: máximo 32 MiB.');
      return;
    }

    const slot = { ...selected };
    const key = slot.size + '/' + slot.side;
    const version = (importVersions.current.get(key) ?? 0) + 1;

    importVersions.current.set(key, version);

    const previousPreviewUrl = selectedTemplate?.previewUrl;

    const previewUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      if (importVersions.current.get(key) !== version) {
        URL.revokeObjectURL(previewUrl);
        return;
      }

      if (image.naturalWidth * image.naturalHeight > 16_000_000) {
        URL.revokeObjectURL(previewUrl);
        setImportStatus('PNG demasiado grande: máximo 16 MP.');
        return;
      }

      const physicalSize = physicalSizeFromSourcePixels(
        image.naturalWidth,
        image.naturalHeight,
      );

      if (previousPreviewUrl && previousPreviewUrl !== previewUrl) {
        URL.revokeObjectURL(previousPreviewUrl);
      }

      updateSelectedTemplate(
        {
          file,
          previewUrl,
          widthPx: image.naturalWidth,
          heightPx: image.naturalHeight,
          physicalWidthMm: physicalSize.widthMm,
          physicalHeightMm: physicalSize.heightMm,
          alphaThreshold:
            selectedTemplate?.alphaThreshold ?? DEFAULT_ALPHA_THRESHOLD,
        },
        slot,
      );

      setImportStatus(
        `Tamaño automático a 72 PPI: ${(physicalSize.widthMm / 10).toFixed(
          2,
        )} × ${(physicalSize.heightMm / 10).toFixed(2)} cm`,
      );
    };

    image.onerror = () => {
      URL.revokeObjectURL(previewUrl);
      setImportStatus('No se pudo leer el PNG.');
    };

    image.src = previewUrl;
  }

  function getTemplate(
    size: GarmentSize,
    side: PieceSide,
  ): SizeTemplateDraft | undefined {
    return templates.find(
      (template) => template.size === size && template.side === side,
    );
  }

  const splash = showSplash ? <SplashScreen exiting={splashExiting} /> : null;
  const contentClass = showSplash
    ? 'app-content'
    : 'app-content app-content--visible';

  if (view === 'templates') {
    return (
      <div className="app-shell">
        {splash}
        <div className={contentClass}>
        <aside className="sidebar">
          <div className="brand">
            <img
              className="brand-mark"
              src={nestraLogo}
              alt=""
              aria-hidden="true"
            />

            <img className="brand-wordmark" src={nestraWordmark} alt="Nestra" />
          </div>
          <nav className="nav">
            <button className="nav-item" onClick={() => setView('home')}>
              INICIO
            </button>
            <button className="nav-item" onClick={() => setView('jobs')}>
              HISTORIAL
            </button>
            <button
              className="nav-item active"
              onClick={() => setView('templates')}
            >
              BIBLIOTECA
            </button>
            <button className="nav-item" onClick={() => setView('batch')}>
              PRODUCCIÓN
            </button>
          </nav>
        </aside>
        <main className="main-content">
          <GlobalSearch />
          <CompactLibrary
            collections={collections}
            onImport={importDesignCollection}
            onRemove={removeDesignCollection}
            onUpdate={(updated) =>
              setCollections((current) =>
                current.map((item) =>
                  item.id === updated.id ? updated : item,
                ),
              )
            }
          />
        </main>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {splash}
      <div className={contentClass}>
      <aside className="sidebar">
        <div className="brand">
          <img
            className="brand-mark"
            src={nestraLogo}
            alt=""
            aria-hidden="true"
          />

          <img className="brand-wordmark" src={nestraWordmark} alt="Nestra" />
        </div>

        <nav className="nav">
          <button
            className={view === 'home' ? 'nav-item active' : 'nav-item'}
            onClick={() => setView('home')}
          >
            INICIO
          </button>

          <button
            className={view === 'jobs' ? 'nav-item active' : 'nav-item'}
            onClick={() => setView('jobs')}
          >
            HISTORIAL
          </button>
          <button
            className={
              (view as View) === 'templates' ? 'nav-item active' : 'nav-item'
            }
            onClick={() => setView('templates')}
          >
            BIBLIOTECA
          </button>
          <button
            className={view === 'batch' ? 'nav-item active' : 'nav-item'}
            onClick={() => setView('batch')}
          >
            PRODUCCIÓN
          </button>
        </nav>
      </aside>

      <main className="main-content">
        <GlobalSearch />
        <div hidden={view !== 'batch'}>
          <BatchPage templates={templates} collections={collections} />
        </div>
        {view === 'jobs' ? (
          <HistoricalJobs />
        ) : view === 'home' ? (
          <section>
            <h1>Nestra</h1>
            <p className="muted">
              Prepará y optimizá layouts textiles para producción.
            </p>
          </section>
        ) : view === 'batch' ? null : (
          <section className="templates-page">
            <p role="status">{libraryStatus}</p>
            <p role="status">{collectionsStatus}</p>
            {importStatus && <p role="alert">{importStatus}</p>}
            <fieldset
              disabled={!ready}
              style={{ border: 0, padding: 0, margin: 0 }}
            >
              <div className="page-header">
                <div>
                  <h1>Biblioteca de diseños</h1>
                  <p className="muted">
                    Configurá una silueta base para cada talle y lado.
                  </p>
                </div>

                <span className="template-progress">
                  {templates.filter((template) => template.file).length} / 20
                </span>
              </div>

              <DesignCollectionLibrary
                collections={collections}
                onImport={importDesignCollection}
                onRemove={removeDesignCollection}
                onUpdate={(updated) =>
                  setCollections((current) =>
                    current.map((item) =>
                      item.id === updated.id ? updated : item,
                    ),
                  )
                }
              />

              <div className="templates-layout">
                <div className="template-grid">
                  {GARMENT_SIZES.map((size) => (
                    <div className="template-row" key={size}>
                      <div className="size-label">{size}</div>

                      {PIECE_SIDES.map((side) => {
                        const template = getTemplate(size, side);

                        const isSelected =
                          selected.size === size && selected.side === side;

                        return (
                          <button
                            key={side}
                            className={[
                              'template-slot',
                              isSelected ? 'selected' : '',
                              template?.file ? 'configured' : '',
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            onClick={() => setSelected({ size, side })}
                          >
                            <strong>{getPieceSideLabel(side)}</strong>
                            <span>
                              {template?.file
                                ? template.file.name
                                : 'Sin configurar'}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>

                <aside className="template-editor">
                  <div className="template-editor-heading">
                    <div>
                      <span className="eyebrow">Silueta seleccionada</span>
                      <h2>
                        {selected.size} · {getPieceSideLabel(selected.side)}
                      </h2>
                    </div>
                  </div>

                  <label className="field">
                    <span>Archivo PNG</span>
                    <input
                      type="file"
                      accept="image/png"
                      onChange={handleFileChange}
                    />
                  </label>

                  {selectedTemplate?.previewUrl ? (
                    <div className="template-preview">
                      <img
                        src={selectedTemplate.previewUrl}
                        alt={`${selected.size} ${getPieceSideLabel(
                          selected.side,
                        )}`}
                      />
                    </div>
                  ) : (
                    <div className="template-preview empty">
                      Seleccioná un PNG con transparencia.
                    </div>
                  )}

                  {selectedTemplate?.widthPx && selectedTemplate?.heightPx ? (
                    <p className="image-metadata">
                      {selectedTemplate.widthPx} × {selectedTemplate.heightPx}{' '}
                      px
                    </p>
                  ) : null}

                  {selectedTemplate?.physicalWidthMm &&
                  selectedTemplate?.physicalHeightMm ? (
                    <p className="image-metadata">
                      Tamaño físico detectado:{' '}
                      {(selectedTemplate.physicalWidthMm / 10).toFixed(2)} ×{' '}
                      {(selectedTemplate.physicalHeightMm / 10).toFixed(2)} cm
                    </p>
                  ) : selectedTemplate?.file ? (
                    <p className="helper-text">
                      No se encontró tamaño físico en este PNG.
                    </p>
                  ) : null}

                  <label className="field">
                    <span>Alpha threshold</span>

                    <div className="range-field">
                      <input
                        type="range"
                        min="0"
                        max="255"
                        step="1"
                        value={selectedAlphaThreshold}
                        onChange={(event) =>
                          updateSelectedTemplate({
                            alphaThreshold: clampAlphaThreshold(
                              Number(event.target.value),
                            ),
                          })
                        }
                      />

                      <input
                        type="number"
                        min="0"
                        max="255"
                        step="1"
                        value={selectedAlphaThreshold}
                        onChange={(event) =>
                          updateSelectedTemplate({
                            alphaThreshold: clampAlphaThreshold(
                              event.target.value === ''
                                ? DEFAULT_ALPHA_THRESHOLD
                                : Number(event.target.value),
                            ),
                          })
                        }
                      />
                    </div>
                  </label>

                  <p className="helper-text">
                    A mayor threshold, más borde semitransparente se descarta.
                  </p>

                  <label className="field">
                    <span>Simplificación del contorno (px)</span>

                    <div className="range-field">
                      <input
                        type="range"
                        min="0"
                        max="10"
                        step="0.1"
                        value={selectedSimplificationTolerance}
                        onChange={(event) =>
                          updateSelectedTemplate({
                            simplificationTolerancePx: Number(
                              event.target.value,
                            ),
                          })
                        }
                      />

                      <input
                        type="number"
                        min="0"
                        max="10"
                        step="0.1"
                        value={selectedSimplificationTolerance}
                        onChange={(event) =>
                          updateSelectedTemplate({
                            simplificationTolerancePx:
                              event.target.value === ''
                                ? 1.5
                                : Number(event.target.value),
                          })
                        }
                      />
                    </div>
                  </label>

                  <AlphaContourPreview
                    imageUrl={selectedTemplate?.previewUrl}
                    alphaThreshold={selectedAlphaThreshold}
                    simplificationTolerancePx={selectedSimplificationTolerance}
                    label={`Contorno detectado de ${selected.size} ${getPieceSideLabel(
                      selected.side,
                    )}`}
                  />
                  <GeometryPlayground
                    imageUrl={selectedTemplate?.previewUrl}
                    alphaThreshold={selectedAlphaThreshold}
                    simplificationTolerancePx={selectedSimplificationTolerance}
                    physicalWidthMm={selectedTemplate?.physicalWidthMm}
                    physicalHeightMm={selectedTemplate?.physicalHeightMm}
                  />
                  <NestingPreview
                    imageUrl={selectedTemplate?.previewUrl}
                    alphaThreshold={selectedAlphaThreshold}
                    simplificationTolerancePx={selectedSimplificationTolerance}
                    physicalWidthMm={selectedTemplate?.physicalWidthMm}
                    physicalHeightMm={selectedTemplate?.physicalHeightMm}
                  />
                </aside>
              </div>
            </fieldset>
          </section>
        )}
      </main>
      </div>
    </div>
  );
}
