import { PRODUCTION_FABRICS } from '../domain/fabric';
import { physicalSizeFromSourcePixels } from '../domain/source-image-size';
import { TrashIcon } from '../ui/trash-icon';
import { FillGapsIcon } from '../ui/fill-gaps-icon';
import type { FreePngDraft } from './batch-state';
import { validFreePngQuantity } from './free-png-import';

const centimeters = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function FreePngPanel({
  pieces,
  quantity,
  onQuantity,
  onImport,
  onUpdate,
  onRemove,
  onToggleFill,
  extras,
}: {
  readonly pieces: readonly FreePngDraft[];
  readonly quantity: number;
  readonly onQuantity: (quantity: number) => void;
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
      <h3>PNG LIBRE</h3>
      <div className="free-png-controls">
        <button type="button" onClick={onImport}>
          COLOCAR PNG
        </button>
        <input
          type="number"
          min={1}
          step={1}
          value={quantity}
          aria-label="Cantidad inicial de PNG libre"
          onChange={(event) => {
            const value = event.currentTarget.valueAsNumber;
            if (validFreePngQuantity(value)) onQuantity(value);
          }}
        />
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
                <img src={piece.imageUrl} alt="" />
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
                  onChange={(event) => {
                    const value = event.currentTarget.valueAsNumber;
                    if (validFreePngQuantity(value))
                      onUpdate(piece.id, { quantity: value });
                  }}
                />
                <select
                  value={piece.fabric}
                  aria-label={`Tela de ${piece.file.name}`}
                  onChange={(event) =>
                    onUpdate(piece.id, { fabric: event.target.value })
                  }
                >
                  {PRODUCTION_FABRICS.map((fabric) => (
                    <option key={fabric} value={fabric}>
                      {fabric.toUpperCase()}
                    </option>
                  ))}
                </select>
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
