import type { PreflightReport } from '../export/export-plan';

export function BatchExportPanel({
  report,
  onExport,
  onCancel,
  busy,
  exporting,
  exported,
  status,
}: {
  readonly report: PreflightReport;
  readonly onExport: () => void;
  readonly onCancel: () => void;
  readonly busy: boolean;
  readonly exporting: boolean;
  readonly exported: boolean;
  readonly status: string | null;
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

      <div className="batch-export-primary-flow">
        <p className="batch-flow-message">LISTO PARA EXPORTAR</p>

        <div className="batch-flow-arrow" aria-hidden="true">
          ↓
        </div>

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
              {fileCount === 1 ? 'ARCHIVO EXPORTADO' : 'ARCHIVOS EXPORTADOS'}
            </>
          ) : (
            <>
              EXPORTAR {fileCount} {fileCount === 1 ? 'ARCHIVO' : 'ARCHIVOS'}
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
            CANCELAR OPERACIÓN
          </button>
        </div>
      ) : null}

      <div className="batch-export-layouts">
        {report.layouts.map((layout) => (
          <figure key={layout.name} className="batch-export-layout">
            <figcaption className="batch-export-caption">
              {layout.name} · {(layout.widthMm / 10).toFixed(2)} ×{' '}
              {(layout.heightMm / 10).toFixed(2)} cm · {layout.widthPx} ×{' '}
              {layout.heightPx} px
            </figcaption>

            <svg
              viewBox={`${layout.offsetX} ${layout.offsetY} ${layout.widthMm} ${layout.heightMm}`}
              style={{
                background: 'white',
                display: 'block',
                width: '100%',
                maxWidth: 740,
                height: 'auto',
                marginInline: 'auto',
                aspectRatio: `${layout.widthMm} / ${layout.heightMm}`,
              }}
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
            </svg>
          </figure>
        ))}
      </div>
    </section>
  );
}
