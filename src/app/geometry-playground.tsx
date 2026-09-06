import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { extractLargestAlphaPolygon } from '../geometry/alpha-polygon';
import type { Polygon } from '../geometry/polygon';
import { polygonsOverlap } from '../geometry/polygon-collision';
import {
  polygonPixelsToMillimeters,
  transformPolygon,
  type PieceRotation,
  type PolygonPlacement,
} from '../geometry/polygon-transform';
import { polygonFitsInsideCanvas } from '../geometry/canvas-geometry';

const CANVAS_WIDTH_MM = 1480;
const CANVAS_HEIGHT_MM = 1000;

const VIEW_WIDTH_PX = 740;
const VIEW_HEIGHT_PX = 500;

interface GeometryPlaygroundProps {
  readonly imageUrl?: string | undefined;
  readonly alphaThreshold: number;
  readonly simplificationTolerancePx: number;
  readonly physicalWidthMm?: number | undefined;
  readonly physicalHeightMm?: number | undefined;
}

interface DragState {
  readonly pieceIndex: number;
  readonly offsetXmm: number;
  readonly offsetYmm: number;
}

function getPlacementBounds(polygon: Polygon): {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
} {
  const first = polygon[0];

  if (!first) {
    return {
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0,
    };
  }

  let minX = first.x;
  let minY = first.y;
  let maxX = first.x;
  let maxY = first.y;

  for (const point of polygon) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
  };
}

function pointInsideBounds(x: number, y: number, polygon: Polygon): boolean {
  const bounds = getPlacementBounds(polygon);

  return (
    x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY
  );
}

export function GeometryPlayground({
  imageUrl,
  alphaThreshold,
  simplificationTolerancePx,
  physicalWidthMm,
  physicalHeightMm,
}: GeometryPlaygroundProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [physicalPolygon, setPhysicalPolygon] = useState<Polygon | null>(null);

  const [error, setError] = useState<string | null>(null);

  const [placements, setPlacements] = useState<
    readonly [PolygonPlacement, PolygonPlacement]
  >([
    {
      x: 40,
      y: 40,
      rotation: 0,
    },
    {
      x: 500,
      y: 120,
      rotation: 0,
    },
  ]);

  const [dragState, setDragState] = useState<DragState | null>(null);

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
        setError('No se pudo leer la geometría de la imagen.');
        return;
      }

      context.drawImage(image, 0, 0);

      const imageData = context.getImageData(
        0,
        0,
        sourceCanvas.width,
        sourceCanvas.height,
      );

      const result = extractLargestAlphaPolygon(
        imageData,
        alphaThreshold,
        simplificationTolerancePx,
      );

      if (!result) {
        setPhysicalPolygon(null);
        setError('No se pudo extraer un polígono válido.');
        return;
      }

      const polygonMm = polygonPixelsToMillimeters(
        result.simplifiedPolygon,
        image.naturalWidth,
        image.naturalHeight,
        physicalWidthMm,
        physicalHeightMm,
      );

      setPhysicalPolygon(polygonMm);
      setError(null);
    };

    image.onerror = () => {
      if (!cancelled) {
        setError('No se pudo cargar la imagen.');
        setPhysicalPolygon(null);
      }
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

  const firstPlaced = physicalPolygon
    ? transformPolygon(physicalPolygon, placements[0])
    : null;

  const secondPlaced = physicalPolygon
    ? transformPolygon(physicalPolygon, placements[1])
    : null;

  const piecesOverlap =
    firstPlaced && secondPlaced
      ? polygonsOverlap(firstPlaced, secondPlaced)
      : false;

  const firstFits =
    firstPlaced !== null &&
    polygonFitsInsideCanvas(firstPlaced, {
      width: CANVAS_WIDTH_MM,
      height: CANVAS_HEIGHT_MM,
    });

  const secondFits =
    secondPlaced !== null &&
    polygonFitsInsideCanvas(secondPlaced, {
      width: CANVAS_WIDTH_MM,
      height: CANVAS_HEIGHT_MM,
    });

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const context = canvas.getContext('2d');

    if (!context) {
      return;
    }

    const drawingContext = context;

    canvas.width = VIEW_WIDTH_PX;
    canvas.height = VIEW_HEIGHT_PX;

    context.clearRect(0, 0, canvas.width, canvas.height);

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.strokeStyle = '#cbd5e1';
    context.lineWidth = 1;
    context.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);

    const scaleX = VIEW_WIDTH_PX / CANVAS_WIDTH_MM;
    const scaleY = VIEW_HEIGHT_PX / CANVAS_HEIGHT_MM;

    function drawPolygon(polygon: Polygon, valid: boolean): void {
      const first = polygon[0];

      if (!first) {
        return;
      }

      drawingContext.beginPath();
      drawingContext.moveTo(first.x * scaleX, first.y * scaleY);

      for (let index = 1; index < polygon.length; index += 1) {
        const point = polygon[index];

        if (!point) {
          continue;
        }

        drawingContext.lineTo(point.x * scaleX, point.y * scaleY);
      }

      drawingContext.closePath();

      drawingContext.fillStyle = valid
        ? 'rgba(34, 197, 94, 0.22)'
        : 'rgba(239, 68, 68, 0.25)';

      drawingContext.strokeStyle = valid ? '#16a34a' : '#dc2626';
      drawingContext.lineWidth = 2;

      drawingContext.fill();
      drawingContext.stroke();
    }

    if (firstPlaced) {
      drawPolygon(firstPlaced, firstFits && !piecesOverlap);
    }

    if (secondPlaced) {
      drawPolygon(secondPlaced, secondFits && !piecesOverlap);
    }
  }, [firstPlaced, secondPlaced, firstFits, secondFits, piecesOverlap]);

  function pointerToMillimeters(event: ReactPointerEvent<HTMLCanvasElement>): {
    readonly x: number;
    readonly y: number;
  } {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();

    const xPx = ((event.clientX - rect.left) / rect.width) * VIEW_WIDTH_PX;

    const yPx = ((event.clientY - rect.top) / rect.height) * VIEW_HEIGHT_PX;

    return {
      x: (xPx / VIEW_WIDTH_PX) * CANVAS_WIDTH_MM,
      y: (yPx / VIEW_HEIGHT_PX) * CANVAS_HEIGHT_MM,
    };
  }

  function handlePointerDown(
    event: ReactPointerEvent<HTMLCanvasElement>,
  ): void {
    if (!firstPlaced || !secondPlaced) {
      return;
    }

    const pointer = pointerToMillimeters(event);

    let pieceIndex: number | null = null;

    if (pointInsideBounds(pointer.x, pointer.y, secondPlaced)) {
      pieceIndex = 1;
    } else if (pointInsideBounds(pointer.x, pointer.y, firstPlaced)) {
      pieceIndex = 0;
    }

    if (pieceIndex === null) {
      return;
    }

    const placement = placements[pieceIndex];

    if (!placement) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);

    setDragState({
      pieceIndex,
      offsetXmm: pointer.x - placement.x,
      offsetYmm: pointer.y - placement.y,
    });
  }

  function handlePointerMove(
    event: ReactPointerEvent<HTMLCanvasElement>,
  ): void {
    if (!dragState) {
      return;
    }

    const pointer = pointerToMillimeters(event);

    setPlacements((current) => {
      const next = [...current] as [PolygonPlacement, PolygonPlacement];

      const previous = next[dragState.pieceIndex];

      if (!previous) {
        return current;
      }

      next[dragState.pieceIndex] = {
        ...previous,
        x: pointer.x - dragState.offsetXmm,
        y: pointer.y - dragState.offsetYmm,
      };

      return next;
    });
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLCanvasElement>): void {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    setDragState(null);
  }

  function rotateSecondPiece(): void {
    setPlacements((current) => {
      const rotations: readonly PieceRotation[] = [0, 90, 180, -90];

      const currentRotation = current[1].rotation;
      const index = rotations.indexOf(currentRotation);
      const nextRotation = rotations[(index + 1) % rotations.length] ?? 0;

      return [
        current[0],
        {
          ...current[1],
          rotation: nextRotation,
        },
      ];
    });
  }

  if (!imageUrl) {
    return (
      <div className="geometry-playground-empty">
        Cargá primero una silueta PNG.
      </div>
    );
  }

  if (!physicalWidthMm || !physicalHeightMm) {
    return (
      <div className="geometry-playground-empty">
        Ingresá el ancho y alto físico de la silueta para probarla dentro del
        canvas.
      </div>
    );
  }

  return (
    <div className="geometry-playground">
      <div className="geometry-playground-header">
        <div>
          <span className="eyebrow">Prueba geométrica</span>
          <h3>Canvas 1480 × 1000 mm</h3>
        </div>

        <button
          className="secondary-button"
          type="button"
          onClick={rotateSecondPiece}
        >
          Rotar pieza 2
        </button>
      </div>

      {error ? <p className="geometry-error">{error}</p> : null}

      <canvas
        ref={canvasRef}
        className="physical-canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />

      <div className="geometry-status">
        <span>
          Pieza 1:{' '}
          <strong>
            {firstFits && !piecesOverlap
              ? 'Válida'
              : piecesOverlap
                ? 'Colisión'
                : 'Fuera del canvas'}
          </strong>
        </span>

        <span>
          Pieza 2:{' '}
          <strong>
            {secondFits && !piecesOverlap
              ? 'Válida'
              : piecesOverlap
                ? 'Colisión'
                : 'Fuera del canvas'}
          </strong>
        </span>

        <span>
          Superposición: <strong>{piecesOverlap ? 'Sí' : 'No'}</strong>
        </span>
      </div>
    </div>
  );
}
