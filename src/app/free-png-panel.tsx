import { physicalSizeFromSourcePixels } from '../domain/source-image-size';
import { TrashIcon } from '../ui/trash-icon';
import { FillGapsIcon } from '../ui/fill-gaps-icon';
import type { FreePngDraft } from './batch-state';
import { validFreePngQuantity } from './free-png-import';
import { ImageLightbox } from './image-lightbox';

const centimeters = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function FreePngPanel({
  pieces,
  onImport,
  onUpdate,
  onRemove,
  onToggleFill,
  extras,
}: {
  readonly pieces: readonly FreePngDraft[];
  readonly onImport: () => void;
  readonly onUpdate: (
    id: string,
    patch: Partial<Pick<FreePngDraft, 'quantity' | 'fabric'>>,
  ) => void;
  readonly onRemove: (id: string) => void;
  readonly onToggleFill: (id: string) => void;
  readonly extras?: ReadonlyMap<string, number> | undefined;
}) {
  return (
    <section className="free-png" aria-label="PNG libre">
      <div className="free-png-heading">
        <div className="free-png-section-title">
          <span>02</span>
          <div>
            <h2>Piezas PNG</h2>
            <p>Archivos libres a 72 PPI, requeridos o para completar espacios.</p>
          </div>
        </div>
        <div className="free-png-controls">
          <button type="button" className="secondary-button" onClick={onImport}>
            Agregar PNG
          </button>
        </div>
      </div>
      {pieces.length > 0 && (
        <ul className="free-png-list">
          {pieces.map((piece) => {
            const size = physicalSizeFromSourcePixels(
              piece.sourceWidthPx,
              piece.sourceHeightPx,
            );
            return (
              <li key={piece.id} className="free-png-row">
                <ImageLightbox
                  label={`Ampliar ${piece.file.name}`}
                  trigger={<img src={piece.imageUrl} alt="" />}
                >
                  <img src={piece.imageUrl} alt={piece.file.name} />
                </ImageLightbox>
                <span className="free-png-name" title={piece.file.name}>
                  {piece.file.name}
                </span>
                <span className="free-png-size">
                  {centimeters.format(size.widthMm / 10)} ×{' '}
                  {centimeters.format(size.heightMm / 10)} cm
                </span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={piece.quantity}
                  aria-label={`Cantidad de ${piece.file.name}`}
                  onDoubleClick={(event) => event.currentTarget.select()}
                  onChange={(event) => {
                    const value = event.currentTarget.valueAsNumber;
                    if (validFreePngQuantity(value))
                      onUpdate(piece.id, { quantity: value });
                  }}
                />
                <input
                  type="text"
                  value={piece.fabric}
                  placeholder="set"
                  aria-label={`Tela de ${piece.file.name}`}
                  onChange={(event) =>
                    onUpdate(piece.id, { fabric: event.target.value })
                  }
                />
                <button
                  className="free-png-fill"
                  data-fill-mode={piece.fill?.mode ?? 'off'}
                  type="button"
                  aria-pressed={Boolean(piece.fill)}
                  aria-label={piece.fill?.mode === 'max'
                    ? 'RELLENAR SOBRANTES · MÁXIMA IMPORTANCIA'
                    : piece.fill
                      ? 'RELLENAR SOBRANTES · ACTIVO'
                      : 'RELLENAR SOBRANTES'}
                  title={piece.fill?.mode === 'max'
                    ? 'RELLENAR SOBRANTES · MÁXIMA IMPORTANCIA'
                    : piece.fill
                      ? 'RELLENAR SOBRANTES · ACTIVO'
                      : 'RELLENAR SOBRANTES'}
                  onClick={() => onToggleFill(piece.id)}
                >
                  <FillGapsIcon max={piece.fill?.mode === 'max'} />
                  <span className="free-png-fill-label">
                    {piece.fill?.mode === 'max'
                      ? 'MAX'
                      : piece.fill
                        ? 'NORMAL'
                        : 'OFF'}
                  </span>
                </button>
                {(extras?.get(piece.id) ?? 0) > 0 && (
                  <span className="free-png-extra-count">
                    +{extras!.get(piece.id)}
                  </span>
                )}
                <button
                  className="free-png-remove"
                  type="button"
                  aria-label={`Eliminar ${piece.file.name}`}
                  onClick={() => onRemove(piece.id)}
                >
                  <TrashIcon />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
