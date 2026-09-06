import { useEffect, useRef, useState } from 'react';
import { extractLargestAlphaPolygon } from '../geometry/alpha-polygon';
import {
  nestSinglePolygon,
  type NestingResult,
} from '../geometry/nesting-engine';
import type { Polygon } from '../geometry/polygon';
import {
  polygonPixelsToMillimeters,
  type PieceRotation,
} from '../geometry/polygon-transform';

const CANVAS_WIDTH_MM = 1480;
const CANVAS_HEIGHT_MM = 1000;

const VIEW_WIDTH_PX = 740;
const VIEW_HEIGHT_PX = 500;

interface NestingPreviewProps {
  readonly imageUrl?: string | undefined;
  readonly alphaThreshold: number;
  readonly simplificationTolerancePx: number;
  readonly physicalWidthMm?: number | undefined;
  readonly physicalHeightMm?: number | undefined;
}

export function NestingPreview({
  imageUrl,
  alphaThreshold,
  simplificationTolerancePx,
  physicalWidthMm,
  physicalHeightMm,
}: NestingPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [physicalPolygon, setPhysicalPolygon] = useState<Polygon | null>(null);

  const [quantity, setQuantity] = useState(6);
  const [scanStepMm, setScanStepMm] = useState(10);
  const [allowQuarterTurns, setAllowQuarterTurns] = useState(true);

  const [result, setResult] = useState<NestingResult | null>(null);

  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  useEffect(() => {
    if (
      !imageUrl ||
      !physicalWidthMm ||
      !physicalHeightMm ||
      physicalWidthMm <= 0 ||
      physicalHeightMm <= 0
    ) {
      return;
    }

    let cancelled = false;
    const image = new Image();

    image.onload = () => {
      if (cancelled) {
        return;
      }

      const sourceCanvas = document.createElement('canvas');
      sourceCanvas.width = image.naturalWidth;
      sourceCanvas.height = image.naturalHeight;

      const context = sourceCanvas.getContext('2d');

      if (!context) {
        return;
      }

      context.drawImage(image, 0, 0);

      const imageData = context.getImageData(
        0,
        0,
        sourceCanvas.width,
        sourceCanvas.height,
      );

      const polygonResult = extractLargestAlphaPolygon(
        imageData,
        alphaThreshold,
        simplificationTolerancePx,
      );

      if (!polygonResult) {
        return;
      }

      const polygon = polygonPixelsToMillimeters(
        polygonResult.simplifiedPolygon,
        image.naturalWidth,
        image.naturalHeight,
        physicalWidthMm,
        physicalHeightMm,
      );

      setPhysicalPolygon(polygon);

      /*
       * El resultado anterior corresponde a otra geometría,
       * por lo que deja de ser válido.
       */
      setResult(null);
      setElapsedMs(null);
    };

    image.src = imageUrl;

    return () => {
      cancelled = true;
    };
  }, [
    imageUrl,
    alphaThreshold,
    simplificationTolerancePx,
    physicalWidthMm,
    physicalHeightMm,
  ]);

  function runNesting(): void {
    if (!physicalPolygon) {
      return;
    }

    const allowedRotations: readonly PieceRotation[] = allowQuarterTurns
      ? [0, 90, 180, -90]
      : [0, 180];

    const start = performance.now();

    const nextResult = nestSinglePolygon({
      polygon: physicalPolygon,
      quantity,
      allowedRotations,
      canvas: {
        width: CANVAS_WIDTH_MM,
        height: CANVAS_HEIGHT_MM,
      },
      scanStepMm,
    });

    const end = performance.now();

    setResult(nextResult);
    setElapsedMs(end - start);
  }

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const context = canvas.getContext('2d');

    if (!context) {
      return;
    }

    canvas.width = VIEW_WIDTH_PX;
    canvas.height = VIEW_HEIGHT_PX;

    context.clearRect(0, 0, canvas.width, canvas.height);

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.strokeStyle = '#cbd5e1';
    context.lineWidth = 1;
    context.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);

    if (!result) {
      return;
    }

    const scaleX = VIEW_WIDTH_PX / CANVAS_WIDTH_MM;
    const scaleY = VIEW_HEIGHT_PX / CANVAS_HEIGHT_MM;

    for (const piece of result.placed) {
      const first = piece.polygon[0];

      if (!first) {
        continue;
      }

      context.beginPath();
      context.moveTo(first.x * scaleX, first.y * scaleY);

      for (let index = 1; index < piece.polygon.length; index += 1) {
        const point = piece.polygon[index];

        if (!point) {
          continue;
        }

        context.lineTo(point.x * scaleX, point.y * scaleY);
      }

      context.closePath();

      context.fillStyle = 'rgba(59, 130, 246, 0.18)';
      context.strokeStyle = '#2563eb';
      context.lineWidth = 1.5;

      context.fill();
      context.stroke();
    }
  }, [result]);

  if (!imageUrl) {
    return null;
  }

  if (!physicalWidthMm || !physicalHeightMm) {
    return (
      <div className="geometry-playground-empty">
        Ingresá primero las medidas físicas.
      </div>
    );
  }

  return (
    <div className="geometry-playground">
      <div className="geometry-playground-header">
        <div>
          <span className="eyebrow">Nesting automático MVP</span>
          <h3>Canvas 1480 × 1000 mm</h3>
        </div>

        <button
          className="secondary-button"
          type="button"
          disabled={!physicalPolygon}
          onClick={runNesting}
        >
          Optimizar
        </button>
      </div>

      <div className="nesting-controls">
        <label className="field">
          <span>Cantidad</span>
          <input
            type="number"
            min="1"
            max="100"
            step="1"
            value={quantity}
            onChange={(event) =>
              setQuantity(Math.max(1, Number(event.target.value) || 1))
            }
          />
        </label>

        <label className="field">
          <span>Resolución de búsqueda (mm)</span>
          <input
            type="number"
            min="5"
            max="50"
            step="1"
            value={scanStepMm}
            onChange={(event) =>
              setScanStepMm(Math.max(5, Number(event.target.value) || 10))
            }
          />
        </label>

        <label className="nesting-checkbox">
          <input
            type="checkbox"
            checked={allowQuarterTurns}
            onChange={(event) => setAllowQuarterTurns(event.target.checked)}
          />
          <span>Permitir 90° / -90°</span>
        </label>
      </div>

      <p className="helper-text">
        Los cambios no recalculan automáticamente. Presioná Optimizar cuando
        quieras ejecutar una prueba.
      </p>

      <canvas ref={canvasRef} className="physical-canvas" />

      {result ? (
        <div className="geometry-status">
          <span>
            Solicitadas: <strong>{quantity}</strong>
          </span>

          <span>
            Colocadas: <strong>{result.placed.length}</strong>
          </span>

          <span>
            Sin colocar: <strong>{result.unplacedCount}</strong>
          </span>

          <span>
            Área usada:{' '}
            <strong>
              {Math.round(result.usedWidth)} × {Math.round(result.usedHeight)}{' '}
              mm
            </strong>
          </span>

          {elapsedMs !== null ? (
            <span>
              Tiempo: <strong>{(elapsedMs / 1000).toFixed(2)} s</strong>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
