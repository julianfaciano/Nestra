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
import {
  BatchPage,
  type BatchExportSummary,
  type BatchOptimizationSummary,
} from './batch-page';
import { physicalSizeFromSourcePixels } from '../domain/source-image-size';
import { DesignCollectionLibrary } from './design-collection-library';
import type { DesignCollection } from './design-collection-state';
import { HistoricalJobs } from './historical-jobs';

type View = 'home' | 'templates' | 'batch' | 'jobs';
const SIDEBAR_SESSION_KEY = 'nestra:sidebar-collapsed';

function NavIcon({ view }: { readonly view: View }) {
  const paths: Record<View, React.ReactNode> = {
    home: <><path d="M4 10.5 10 5l6 5.5" /><path d="M6.5 9.5V16h7V9.5" /></>,
    jobs: <><path d="M5 4.5h10v11H5z" /><path d="M7.5 8h5M7.5 11h5" /></>,
    templates: <><rect x="4" y="4" width="5" height="5" rx="1" /><rect x="11" y="4" width="5" height="5" rx="1" /><rect x="4" y="11" width="5" height="5" rx="1" /><rect x="11" y="11" width="5" height="5" rx="1" /></>,
    batch: <><path d="M4 6h12M4 10h12M4 14h8" /><circle cx="15" cy="14" r="1" /></>,
  };

  return (
    <svg className="nav-icon" viewBox="0 0 20 20" aria-hidden="true">
      {paths[view]}
    </svg>
  );
}

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
          <h1>Biblioteca</h1>
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return window.sessionStorage.getItem(SIDEBAR_SESSION_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [batchOptimization, setBatchOptimization] =
    useState<BatchOptimizationSummary>({
      status: 'idle',
      progress: 0,
      phase: 'Preparando',
      resultAvailable: false,
    });
  const [batchExport, setBatchExport] = useState<BatchExportSummary>({
    status: 'idle',
    phase: 'Preparando exportación',
  });

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

  useEffect(() => {
    try {
      window.sessionStorage.setItem(
        SIDEBAR_SESSION_KEY,
        String(sidebarCollapsed),
      );
    } catch {
      // El layout puede seguir funcionando sin almacenamiento de sesión.
    }
  }, [sidebarCollapsed]);

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
  const visibleActivity =
    batchExport.status === 'running' ||
    batchExport.status === 'completed' ||
    batchExport.status === 'error'
      ? { kind: 'export' as const, state: batchExport }
      : batchOptimization.status === 'running' ||
          batchOptimization.status === 'completed' ||
          batchOptimization.status === 'error'
        ? { kind: 'optimization' as const, state: batchOptimization }
        : null;

  return (
    <div
      className={[
        'app-shell',
        sidebarCollapsed ? 'app-shell--sidebar-collapsed' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {splash}
      <div className={contentClass}>
      <aside
        className={[
          'sidebar',
          sidebarCollapsed ? 'sidebar--collapsed' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div className="brand">
          <img
            className="brand-mark"
            src={nestraLogo}
            alt=""
            aria-hidden="true"
          />

          <img className="brand-wordmark" src={nestraWordmark} alt="Nestra" />
          <button
            type="button"
            className="sidebar-toggle"
            aria-label={
              sidebarCollapsed ? 'Mostrar barra lateral' : 'Ocultar barra lateral'
            }
            aria-expanded={!sidebarCollapsed}
            title={
              sidebarCollapsed ? 'Mostrar barra lateral' : 'Ocultar barra lateral'
            }
            onClick={() => setSidebarCollapsed((current) => !current)}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path
                d={sidebarCollapsed ? 'm6.5 4 4 4-4 4' : 'm9.5 4-4 4 4 4'}
              />
            </svg>
          </button>
        </div>

        <nav className="nav" aria-label="Navegación principal">
          {([
            ['home', 'Inicio'],
            ['jobs', 'Historial'],
            ['templates', 'Biblioteca'],
            ['batch', 'Producción'],
          ] as const).map(([nextView, label]) => (
            <button
              key={nextView}
              className={view === nextView ? 'nav-item active' : 'nav-item'}
              aria-label={label}
              title={sidebarCollapsed ? label : undefined}
              onClick={() => setView(nextView)}
            >
              <NavIcon view={nextView} />
              <span className="nav-label">{label}</span>
            </button>
          ))}
        </nav>
        {view !== 'batch' && visibleActivity ? (
          <button
            type="button"
            className={[
              'sidebar-optimization-card',
              `sidebar-optimization-card--${visibleActivity.state.status}`,
              `sidebar-optimization-card--${visibleActivity.kind}`,
            ].join(' ')}
            onClick={() => setView('batch')}
          >
            <span className="sidebar-optimization-label">
              {visibleActivity.kind === 'export'
                ? visibleActivity.state.status === 'running'
                  ? 'EXPORTANDO'
                  : visibleActivity.state.status === 'error'
                    ? 'ERROR'
                    : 'EXPORTADO'
                : visibleActivity.state.status === 'running'
                  ? 'OPTIMIZANDO'
                  : visibleActivity.state.status === 'error'
                    ? 'ERROR'
                    : 'LISTO'}
            </span>
            {visibleActivity.kind === 'optimization' ? (
              <>
                <strong>{visibleActivity.state.progress}%</strong>
                <span
                  className="optimization-progress-track"
                  role="progressbar"
                  aria-label="Progreso de optimización"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={visibleActivity.state.progress}
                >
                  <span style={{ width: `${visibleActivity.state.progress}%` }} />
                </span>
              </>
            ) : visibleActivity.state.status === 'running' ? (
              <span className="sidebar-activity-indeterminate" aria-hidden="true" />
            ) : (
              <strong aria-hidden="true">
                {visibleActivity.state.status === 'error' ? '!' : '✓'}
              </strong>
            )}
            <span className="sidebar-optimization-phase">
              {visibleActivity.state.status === 'completed'
                ? visibleActivity.kind === 'export'
                  ? 'Exportación terminada'
                  : 'Ver resultado'
                : visibleActivity.state.phase}
            </span>
          </button>
        ) : null}
      </aside>

      <main className="main-content">
        <GlobalSearch />
        <div hidden={view !== 'batch'}>
          <BatchPage
            templates={templates}
            collections={collections}
            onOptimizationChange={setBatchOptimization}
            onExportChange={setBatchExport}
          />
        </div>
        {view === 'templates' ? (
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
        ) : view === 'jobs' ? (
          <HistoricalJobs />
        ) : view === 'home' ? (
          <section className="home-page">
            <div className="home-identity">
              <p className="home-kicker">Producción textil</p>
              <h1>Nestra</h1>
              <p className="home-statement">
                Prepará, optimizá y exportá layouts listos para producción.
              </p>
              <button
                type="button"
                className="primary-button home-primary-action"
                onClick={() => setView('batch')}
              >
                Empezar producción <span aria-hidden="true">→</span>
              </button>
            </div>

            <div className="home-index" aria-label="Accesos rápidos">
              <p className="home-index-label">ESPACIOS DE TRABAJO</p>
              {([
                ['batch', '01', 'Producción', 'Preparar un nuevo batch'],
                ['templates', '02', 'Biblioteca', `${collections.length} diseños disponibles`],
                ['jobs', '03', 'Historial', 'Revisar producciones anteriores'],
              ] as const).map(([nextView, number, label, detail]) => (
                <button type="button" key={nextView} onClick={() => setView(nextView)}>
                  <span className="home-index-number">{number}</span>
                  <NavIcon view={nextView} />
                  <span className="home-index-copy">
                    <strong>{label}</strong>
                    <small>{detail}</small>
                  </span>
                  <span className="home-index-arrow" aria-hidden="true">↗</span>
                </button>
              ))}
              {visibleActivity ? (
                <button
                  type="button"
                  className="home-current-activity"
                  onClick={() => setView('batch')}
                >
                  <span className="home-index-number">EN CURSO</span>
                  <span className="home-index-copy">
                    <strong>{visibleActivity.kind === 'export' ? 'Exportación' : 'Optimización'}</strong>
                    <small>
                      {visibleActivity.kind === 'optimization'
                        ? `${visibleActivity.state.progress}% · ${visibleActivity.state.phase}`
                        : visibleActivity.state.phase}
                    </small>
                  </span>
                  <span className="home-index-arrow" aria-hidden="true">→</span>
                </button>
              ) : null}
            </div>
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
