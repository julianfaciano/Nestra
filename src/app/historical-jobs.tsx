import { useEffect, useRef, useState } from 'react';

import { invoke } from '@tauri-apps/api/core';

import {
  buildImportedHistoricalJob,
  formatHistoricalDate,
  groupHistoricalJobs,
  loadHistoricalJobs,
  mergeHistoricalJobs,
  saveHistoricalJobs,
  type HistoricalFile,
  type HistoricalJob,
  type NativeHistoricalJob,
} from '../persistence/historical-jobs';
import {
  deleteHistoricalPreview,
  loadHistoricalPreview,
} from '../persistence/historical-preview-cache';
import { TrashIcon } from '../ui/trash-icon';

const NUMBER_TWO_DECIMALS = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatMeters(value: number): string {
  return NUMBER_TWO_DECIMALS.format(Math.max(0, value));
}

function formatFileSize(size: number): string {
  return `${NUMBER_TWO_DECIMALS.format(size / 1024 / 1024)} MB`;
}

function formatPhysicalSize(file: HistoricalFile): string {
  if (
    file.physicalWidthCm !== undefined &&
    file.physicalHeightCm !== undefined
  ) {
    return `${NUMBER_TWO_DECIMALS.format(
      file.physicalWidthCm,
    )} × ${NUMBER_TWO_DECIMALS.format(file.physicalHeightCm)} cm`;
  }

  if (file.widthPx !== undefined && file.heightPx !== undefined) {
    return `${file.widthPx.toLocaleString(
      'es-AR',
    )} × ${file.heightPx.toLocaleString('es-AR')} px`;
  }

  return 'Medida no disponible';
}

function jobSummary(job: HistoricalJob): string {
  const parts = [
    formatHistoricalDate(job.createdAt),

    `${job.canvasCount.toLocaleString('es-AR')} canvas`,

    `${formatMeters(job.meters.deportiva)} metros deportiva`,

    `${formatMeters(job.meters.polar)} metros polar`,
  ];

  if (job.meters.unclassified > 0.0001) {
    parts.push(
      `${formatMeters(job.meters.unclassified)} metros sin clasificar`,
    );
  }

  return parts.join(' · ');
}

function historicalCardTitle(job: HistoricalJob): string {
  if (job.importedHistorical) {
    const originalDate = job.name.match(/\(([^)]+)\)/)?.[1];

    if (originalDate) {
      return `(${originalDate})`;
    }
  }

  const normalized = formatHistoricalDate(job.createdAt).replaceAll('/', '-');

  return `(${normalized})`;
}

function HistoricalThumbnail({ file }: { readonly file: HistoricalFile }) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  const [url, setUrl] = useState<string | null>(null);

  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!file.thumbnailKey) {
      return;
    }

    const thumbnailKey = file.thumbnailKey;

    let disposed = false;
    let objectUrl: string | null = null;
    let loading = false;

    const load = async (): Promise<void> => {
      if (loading || disposed) {
        return;
      }

      loading = true;

      try {
        const blob = thumbnailKey.startsWith('nestra:')
          ? await loadHistoricalPreview(thumbnailKey)
          : new Blob(
              [
                new Uint8Array(
                  await invoke<number[]>('load_historical_thumbnail', {
                    key: thumbnailKey,
                  }),
                ),
              ],
              {
                type: 'image/jpeg',
              },
            );

        if (disposed) {
          return;
        }

        if (!blob) {
          throw new Error('Preview histórico no encontrado.');
        }

        objectUrl = URL.createObjectURL(blob);

        setUrl(objectUrl);
      } catch {
        if (!disposed) {
          setFailed(true);
        }
      }
    };

    const host = hostRef.current;

    if (!host) {
      return;
    }

    if (typeof IntersectionObserver === 'undefined') {
      void load();

      return () => {
        disposed = true;

        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
        }
      };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          void load();
        }
      },
      {
        rootMargin: '220px 0px',
      },
    );

    observer.observe(host);

    return () => {
      disposed = true;
      observer.disconnect();

      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [file.thumbnailKey]);

  return (
    <div ref={hostRef} className="historical-preview-image-host">
      {url ? (
        <img
          src={url}
          alt={file.name}
          loading="lazy"
          className="historical-preview-image"
        />
      ) : failed ? (
        <span className="historical-preview-placeholder">
          PREVIEW NO DISPONIBLE
        </span>
      ) : file.thumbnailKey ? (
        <span className="historical-preview-placeholder">CARGANDO PREVIEW</span>
      ) : (
        <span className="historical-preview-placeholder">
          REIMPORTÁ PARA GENERAR PREVIEW
        </span>
      )}
    </div>
  );
}

function HistoricalFilePreview({ file }: { readonly file: HistoricalFile }) {
  return (
    <article className="historical-preview-item">
      <div className="historical-preview-name" title={file.name}>
        {file.name}
      </div>

      <HistoricalThumbnail file={file} />

      <div className="historical-preview-details">
        <span>{formatPhysicalSize(file)}</span>

        <span>
          {file.type.toUpperCase()} · {formatFileSize(file.size)}
        </span>
      </div>
    </article>
  );
}

function HistoricalJobCard({
  job,
  onDelete,
}: {
  readonly job: HistoricalJob;

  readonly onDelete: (job: HistoricalJob) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const [collapseGlow, setCollapseGlow] = useState(false);

  const cardRef = useRef<HTMLElement | null>(null);

  const hasFiles = job.files.length > 0;

  const hasSizeSummary = (job.sizeSummary?.length ?? 0) > 0;

  function toggleExpanded(): void {
    if (!expanded) {
      setCollapseGlow(false);
      setExpanded(true);

      return;
    }

    setExpanded(false);
    setCollapseGlow(false);

    window.setTimeout(() => {
      const card = cardRef.current;

      if (!card) {
        return;
      }

      const targetTop = window.scrollY + card.getBoundingClientRect().top - 90;

      window.scrollTo({
        top: Math.max(0, targetTop),
        behavior: 'smooth',
      });

      /*
       * Esperamos a que el scroll realmente
       * se estabilice. Recién después hacemos
       * el glow de confirmación visual.
       */
      let previousY = window.scrollY;
      let stableFrames = 0;
      let frames = 0;

      function waitForScrollEnd(): void {
        const currentY = window.scrollY;

        if (Math.abs(currentY - previousY) < 0.5) {
          stableFrames += 1;
        } else {
          stableFrames = 0;
        }

        previousY = currentY;
        frames += 1;

        if (stableFrames >= 6 || frames >= 120) {
          setCollapseGlow(false);

          window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
              setCollapseGlow(true);

              window.setTimeout(() => {
                setCollapseGlow(false);
              }, 1100);
            });
          });

          return;
        }

        window.requestAnimationFrame(waitForScrollEnd);
      }

      window.requestAnimationFrame(waitForScrollEnd);
    }, 50);
  }

  return (
    <article
      ref={cardRef}
      className={[
        'historical-job-card',

        expanded ? 'is-expanded' : '',

        collapseGlow ? 'is-collapse-glow' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="historical-job-floating-actions">
        {hasFiles ? (
          <button
            type="button"
            className="historical-card-icon-button"
            aria-label={expanded ? 'Contraer batch' : 'Expandir batch'}
            title={expanded ? 'Contraer batch' : 'Expandir batch'}
            onClick={toggleExpanded}
          >
            {expanded ? (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6" />
                <path d="M3 9l6-6M21 9l-6-6M3 15l6 6M21 15l-6 6" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 9H3V3M15 9h6V3M9 15H3v6M15 15h6v6" />
                <path d="M3 3l6 6M21 3l-6 6M3 21l6-6M21 21l-6-6" />
              </svg>
            )}
          </button>
        ) : null}

        <button
          type="button"
          className="batch-remove-button historical-delete-button"
          aria-label={`Eliminar trabajo #${job.jobNumber}`}
          title="Eliminar del historial"
          onClick={() => onDelete(job)}
        >
          <TrashIcon />
        </button>
      </div>

      <header className="historical-job-card-header">
        <div className="historical-job-card-heading">
          <h2>{historicalCardTitle(job)}</h2>

          <p className="historical-job-number">#{job.jobNumber}</p>

          <p className="historical-job-summary">{jobSummary(job)}</p>
        </div>
      </header>

      {job.sourceFolderPath ? (
        <p className="historical-job-path" title={job.sourceFolderPath}>
          {job.sourceFolderPath}
        </p>
      ) : null}

      {hasSizeSummary ? (
        <details className="historical-size-summary">
          <summary>TALLES</summary>

          <div className="historical-size-summary-body">
            {job.sizeSummary?.map((entry) => (
              <div className="historical-size-team" key={`${entry.model}:${entry.fabric ?? ''}`}>
                <strong>{entry.model}</strong>

                <span>
                  {entry.fabric ? `${entry.fabric} · ` : ''}
                  {entry.sizes
                    .map((size) => `${size.size} × ${size.quantity}`)
                    .join(' · ')}
                </span>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {(job.freePngPieces?.length || job.extraPieces?.length) ? (
        <details className="historical-size-summary historical-png-summary">
          <summary>DISEÑOS</summary>
          <div className="historical-size-summary-body">
            {job.freePngPieces?.map(piece => <div className="historical-png-entry" key={JSON.stringify([piece.name, piece.fabric])}>
              <span title={piece.name}>{piece.name}</span><span>{piece.fabric} · ×{piece.count}</span>
            </div>)}
            {!!job.extraPieces?.length && <div className="historical-extra-summary">
              <strong>EXTRA</strong>
              {job.extraPieces.map(piece => <div className="historical-png-entry" key={JSON.stringify([piece.name, piece.fabric])}>
                <span title={piece.name}>{piece.name}</span><span>{piece.fabric} · +{piece.count}</span>
              </div>)}
            </div>}
          </div>
        </details>
      ) : null}

      {hasFiles ? (
        <div className="historical-preview-scroll">
          {job.files.map((file, index) => (
            <HistoricalFilePreview key={`${job.id}:${file.path}:${index}`} file={file} />
          ))}
        </div>
      ) : (
        <div className="historical-job-no-files">
          Registro anterior de Nestra sin previews almacenados.
        </div>
      )}
    </article>
  );
}

export function HistoricalJobs() {
  const [jobs, setJobs] = useState<HistoricalJob[]>(loadHistoricalJobs);
  const visibleJobs = groupHistoricalJobs(jobs);

  const [message, setMessage] = useState('');

  const [isImporting, setIsImporting] = useState(false);
  const [jobPendingRemoval, setJobPendingRemoval] =
    useState<HistoricalJob | null>(null);
  const [scrollDateVisible, setScrollDateVisible] = useState(false);

  const [scrollDate, setScrollDate] = useState('');

  const [scrollDateTop, setScrollDateTop] = useState(0);

  const scrollbarPressedRef = useRef(false);

  const scrollbarHoldTimerRef = useRef<number | null>(null);

  useEffect(() => {
    function clearHoldTimer(): void {
      if (scrollbarHoldTimerRef.current !== null) {
        window.clearTimeout(scrollbarHoldTimerRef.current);

        scrollbarHoldTimerRef.current = null;
      }
    }

    function scrollbarGeometry(): {
      readonly thumbTop: number;
      readonly thumbHeight: number;
    } {
      const root = document.documentElement;

      const viewportHeight = window.innerHeight;

      const scrollHeight = Math.max(root.scrollHeight, viewportHeight);

      const scrollRange = Math.max(0, scrollHeight - viewportHeight);

      const progress =
        scrollRange > 0
          ? Math.min(1, Math.max(0, window.scrollY / scrollRange))
          : 0;

      /*
       * Aproximamos la geometría del thumb
       * nativo para que el badge viaje pegado
       * visualmente a él.
       */
      const thumbHeight = Math.max(
        32,
        (viewportHeight / scrollHeight) * viewportHeight,
      );

      const travel = Math.max(0, viewportHeight - thumbHeight);

      return {
        thumbTop: progress * travel,
        thumbHeight,
      };
    }

    function updateScrollDate(): void {
      const { thumbTop, thumbHeight } = scrollbarGeometry();

      setScrollDateTop(thumbTop + thumbHeight / 2);

      const cards = Array.from(
        document.querySelectorAll<HTMLElement>('.historical-job-card'),
      );

      if (cards.length === 0) {
        return;
      }

      /*
       * Tomamos como trabajo actual la card
       * que está entrando en la parte superior
       * del viewport.
       */
      const probeY = Math.min(120, window.innerHeight / 3);

      let currentIndex = cards.findIndex(
        (card) => card.getBoundingClientRect().bottom > probeY,
      );

      if (currentIndex < 0) {
        currentIndex = cards.length - 1;
      }

      const currentJob = visibleJobs[currentIndex];

      if (currentJob) {
        setScrollDate(formatHistoricalDate(currentJob.createdAt));
      }
    }

    function isScrollbarThumbHit(event: MouseEvent): boolean {
      const root = document.documentElement;

      const hasVerticalScroll = root.scrollHeight > window.innerHeight + 1;

      if (!hasVerticalScroll) {
        return false;
      }

      /*
       * Zona horizontal de la scrollbar.
       * Dejamos unos píxeles de tolerancia
       * para WebView2.
       */
      const scrollbarLeft = Math.min(root.clientWidth, window.innerWidth - 12);

      if (event.clientX < scrollbarLeft) {
        return false;
      }

      const { thumbTop, thumbHeight } = scrollbarGeometry();

      /*
       * Sólo reaccionamos si el click cae
       * aproximadamente sobre el thumb,
       * no simplemente sobre cualquier parte
       * del track.
       */
      return (
        event.clientY >= thumbTop - 5 &&
        event.clientY <= thumbTop + thumbHeight + 5
      );
    }

    function handleMouseDown(event: MouseEvent): void {
      if (event.button !== 0 || !isScrollbarThumbHit(event)) {
        return;
      }

      scrollbarPressedRef.current = true;

      clearHoldTimer();

      scrollbarHoldTimerRef.current = window.setTimeout(() => {
        scrollbarHoldTimerRef.current = null;

        if (!scrollbarPressedRef.current) {
          return;
        }

        updateScrollDate();
        setScrollDateVisible(true);
      }, 500);
    }

    function releaseScrollbar(): void {
      scrollbarPressedRef.current = false;

      clearHoldTimer();

      setScrollDateVisible(false);
    }

    function handleScroll(): void {
      if (scrollbarPressedRef.current || scrollDateVisible) {
        updateScrollDate();
      }
    }

    document.addEventListener('mousedown', handleMouseDown, true);

    window.addEventListener('mouseup', releaseScrollbar, true);

    window.addEventListener('blur', releaseScrollbar);

    window.addEventListener('scroll', handleScroll, {
      passive: true,
    });

    window.addEventListener('resize', updateScrollDate);

    return () => {
      clearHoldTimer();

      document.removeEventListener('mousedown', handleMouseDown, true);

      window.removeEventListener('mouseup', releaseScrollbar, true);

      window.removeEventListener('blur', releaseScrollbar);

      window.removeEventListener('scroll', handleScroll);

      window.removeEventListener('resize', updateScrollDate);
    };
  }, [visibleJobs, scrollDateVisible]);
  async function importJobs(): Promise<void> {
    if (isImporting) {
      return;
    }

    setIsImporting(true);
    setMessage('');

    try {
      const imported = await invoke<NativeHistoricalJob[] | null>(
        'choose_historical_jobs',
      );

      if (!imported) {
        return;
      }

      const next = imported.map(buildImportedHistoricalJob);

      const merged = mergeHistoricalJobs(jobs, next);

      const previousImportedPaths = new Set(
        jobs
          .filter((job) => job.sourceFolderPath)
          .map((job) => job.sourceFolderPath.toLowerCase()),
      );

      const added = next.filter(
        (job) => !previousImportedPaths.has(job.sourceFolderPath.toLowerCase()),
      ).length;

      const updated = next.length - added;

      saveHistoricalJobs(merged);
      setJobs(merged);

      setMessage(`Importados ${added}. Actualizados ${updated}.`);
    } catch (error) {
      setMessage(`No se pudo importar el historial: ${String(error)}`);
    } finally {
      setIsImporting(false);
    }
  }

  async function removeHistoricalJob(): Promise<void> {
    const job = jobPendingRemoval;

    if (!job) {
      return;
    }

    const removedNumber = job.jobNumber;

    const removedIds = new Set(job.sessionJobIds ?? [job.id]);
    const next = jobs.filter((candidate) => !removedIds.has(candidate.id));

    /*
     * Persistimos primero. saveHistoricalJobs()
     * compacta #1...#N.
     */
    saveHistoricalJobs(next);

    /*
     * Volvemos a leer para que la renumeración
     * también aparezca inmediatamente en pantalla.
     */
    setJobs(loadHistoricalJobs());

    setJobPendingRemoval(null);

    setMessage(`Trabajo #${removedNumber} eliminado del Historial.`);

    /*
     * La limpieza de previews es secundaria:
     * el trabajo ya quedó eliminado aunque un
     * archivo de caché estuviera ausente.
     */
    const cleanupTasks: Promise<unknown>[] = [];

    for (const file of job.files) {
      const key = file.thumbnailKey;

      if (!key) {
        continue;
      }

      if (key.startsWith('nestra:')) {
        cleanupTasks.push(deleteHistoricalPreview(key));

        continue;
      }

      cleanupTasks.push(
        invoke<void>('delete_historical_thumbnail', {
          key,
        }),
      );
    }

    const results = await Promise.allSettled(cleanupTasks);

    const failed = results.filter(
      (result) => result.status === 'rejected',
    ).length;

    if (failed > 0) {
      setMessage(
        `Trabajo #${removedNumber} eliminado. ` +
          `No se pudieron limpiar ${failed} preview${failed === 1 ? '' : 's'} del caché.`,
      );
    }
  }
  return (
    <section className="jobs-page">
      <div
        className={[
          'historical-scroll-date',
          scrollDateVisible ? 'is-visible' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={{
          top: `${scrollDateTop}px`,
        }}
        aria-hidden="true"
      >
        {scrollDate}
      </div>
      <div className="page-header">
        <div>
          <h1>Historial</h1>
        </div>

        <button
          className="secondary-button"
          type="button"
          disabled={isImporting}
          onClick={() => void importJobs()}
        >
          {isImporting ? 'IMPORTANDO...' : 'IMPORTAR HISTORIAL'}
        </button>
      </div>

      {visibleJobs.length === 0 ? (
        <div className="jobs-empty">
          <h2>Todavía no hay trabajos guardados.</h2>

          <p className="muted">
            Importá una carpeta padre o registrá un batch nuevo.
          </p>
        </div>
      ) : (
        <div className="historical-job-grid">
          {visibleJobs.map((job) => (
            <HistoricalJobCard
              key={job.id}
              job={job}
              onDelete={setJobPendingRemoval}
            />
          ))}
        </div>
      )}
      {jobPendingRemoval ? (
        <div
          className="confirm-backdrop"
          role="presentation"
          onMouseDown={() => setJobPendingRemoval(null)}
        >
          <div
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-history-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h3 id="remove-history-title">Eliminar trabajo</h3>

            <p>
              ¿Querés eliminar #{jobPendingRemoval.jobNumber} del Historial?
            </p>

            <div className="confirm-dialog-actions">
              <button
                type="button"
                className="confirm-cancel-button"
                onClick={() => setJobPendingRemoval(null)}
              >
                CANCELAR
              </button>

              <button
                type="button"
                className="confirm-delete-button"
                onClick={removeHistoricalJob}
              >
                ELIMINAR
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {message ? (
        <p className="historical-import-status" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
