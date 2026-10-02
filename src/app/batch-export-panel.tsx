import { useEffect, useRef, useState } from 'react';
import type { ExportLayout, PreflightReport } from '../export/export-plan';
import { ImageLightbox } from './image-lightbox';

function ExportArtwork({ layout }: { readonly layout: ExportLayout }) {
  return (
    <svg
      viewBox={`${layout.offsetX} ${layout.offsetY} ${layout.widthMm} ${layout.heightMm}`}
      className="batch-export-artwork"
      aria-label={'Arte de ' + layout.name}
    >
      {layout.pieces.map((art, index) => (
        <image
          key={index}
          href={art.definition.imageUrl}
          x={0}
          y={0}
          width={art.definition.physicalWidthMm}
          height={art.definition.physicalHeightMm}
          transform={`translate(${art.translateX} ${art.translateY}) rotate(${art.placement.rotation})`}
        />
      ))}
      {layout.laserOutline ? layout.pieces.flatMap((art,i) => (art.cutComponents ?? []).map((p,j) => (
        <polygon key={`cut-${i}-${j}`} points={p.map(v=>`${v.x},${v.y}`).join(' ')}
          fill="none" stroke={layout.laserOutline!.color} strokeWidth={layout.laserOutline!.widthMm}
          strokeLinejoin="round" strokeLinecap="round" />
      ))) : null}
    </svg>
  );
}

export function BatchExportPanel({
  report,
  onExport,
  onCancel,
  busy,
  exporting,
  exported,
  status,
  error,
}: {
  readonly report: PreflightReport;
  readonly onExport: () => void;
  readonly onCancel: () => void;
  readonly busy: boolean;
  readonly exporting: boolean;
  readonly exported: boolean;
  readonly status: string | null;
  readonly error?: { readonly message: string; readonly details: string } | null;
}) {
  const fileCount = report.layouts.length;

  return (
    <section
      className="batch-export-panel"
      aria-label="Preflight y exportación"
    >
      {report.errors.length > 0 ? (
        <div className="batch-export-errors">
          <h2>Exportación bloqueada</h2>

          <ul>
            {report.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? (
        <section className="batch-export-errors" role="alert" aria-label="Error de exportación PDF">
          <h2>No se pudieron crear los archivos PDF</h2>
          <p>{error.message}</p>
          {error.details ? (
            <details>
              <summary>Detalles técnicos</summary>
              <pre>{error.details}</pre>
            </details>
          ) : null}
        </section>
      ) : null}

      <div className="batch-export-primary-flow">
        <button
          type="button"
          className={['batch-primary-button', exported ? 'is-exported' : '']
            .filter(Boolean)
            .join(' ')}
          disabled={busy || report.errors.length > 0 || fileCount === 0}
          onClick={onExport}
        >
          {exported ? (
            <>
              {fileCount}{' '}
              {fileCount === 1 ? 'archivo exportado' : 'archivos exportados'}
              <span aria-hidden="true">↗</span>
            </>
          ) : exporting ? (
            <>
              Exportando…
              <span className="batch-export-spinner" aria-hidden="true" />
            </>
          ) : (
            <>
              Exportar {fileCount} {fileCount === 1 ? 'archivo' : 'archivos'}
              <span aria-hidden="true">↗</span>
            </>
          )}
        </button>
      </div>

      {exporting ? (
        <div className="batch-export-active">
          {status ? (
            <p className="batch-status batch-export-status" role="status">
              {status}
            </p>
          ) : null}

          <button
            type="button"
            className="cancel-operation-button"
            onClick={onCancel}
          >
            Cancelar
          </button>
        </div>
      ) : null}

      <div className="batch-export-layouts">
        {report.layouts.map((layout, index) => (
          <DeferredCanvasPreview key={`${layout.name}-${index}`} layout={layout} index={index} />
        ))}
      </div>
    </section>
  );
}

function DeferredCanvasPreview({ layout, index }: { readonly layout: ExportLayout; readonly index: number }) {
  const figureRef = useRef<HTMLElement | null>(null);
  const [nearViewport, setNearViewport] = useState(false);

  useEffect(() => {
    const figure = figureRef.current;
    if (!figure) return;

    if (typeof IntersectionObserver !== 'undefined') {
      const observer = new IntersectionObserver(([entry]) => {
        setNearViewport(Boolean(entry?.isIntersecting));
      }, { rootMargin: '700px 0px' });
      observer.observe(figure);
      return () => observer.disconnect();
    }

    let frame = 0;
    const update = () => {
      frame = 0;
      const bounds = figure.getBoundingClientRect();
      const margin = 700;
      setNearViewport(bounds.bottom >= -margin && bounds.top <= window.innerHeight + margin);
    };
    const scheduleUpdate = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(update);
    };
    scheduleUpdate();
    window.addEventListener('scroll', scheduleUpdate, true);
    window.addEventListener('resize', scheduleUpdate);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', scheduleUpdate, true);
      window.removeEventListener('resize', scheduleUpdate);
    };
  }, []);

  return (
    <figure ref={figureRef} className="batch-export-layout" data-canvas-index={index}>
      <figcaption className="batch-export-caption">
        {layout.name} · {(layout.widthMm / 10).toFixed(2)} × {(layout.heightMm / 10).toFixed(2)} cm · {layout.widthPx} × {layout.heightPx} px
      </figcaption>
      <div
        className="batch-export-preview-slot"
        style={{ aspectRatio: `${layout.widthMm} / ${layout.heightMm}` }}
        aria-label={`Vista previa de ${layout.name}`}
      >
        {nearViewport ? (
          <ImageLightbox
            label={`Ampliar ${layout.name}`}
            trigger={<ExportArtwork layout={layout} />}
          >
            <ExportArtwork layout={layout} />
          </ImageLightbox>
        ) : <div className="batch-export-preview-placeholder" aria-hidden="true" />}
      </div>
    </figure>
  );
}
