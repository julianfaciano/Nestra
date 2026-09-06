import { useEffect, useRef, useState } from 'react';
import {
  clampAlphaThreshold,
  extractAlphaContourMask,
} from '../geometry/alpha-contour';
import { extractLargestAlphaPolygon } from '../geometry/alpha-polygon';

interface AlphaContourPreviewProps {
  readonly imageUrl?: string | undefined;
  readonly alphaThreshold: number;
  readonly simplificationTolerancePx: number;
  readonly label: string;
}

interface AlphaContourStats {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly opaquePixelCount: number;
  readonly edgePixelCount: number;
  readonly rawPolygonPoints: number;
  readonly simplifiedPolygonPoints: number;
}

export function AlphaContourPreview({
  imageUrl,
  alphaThreshold,
  simplificationTolerancePx,
  label,
}: AlphaContourPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [stats, setStats] = useState<AlphaContourStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas || !imageUrl) {
      setStats(null);
      setError(null);
      return;
    }

    let cancelled = false;
    const image = new Image();

    image.onload = () => {
      if (cancelled || !canvasRef.current) {
        return;
      }

      const nextCanvas = canvasRef.current;
      nextCanvas.width = image.naturalWidth;
      nextCanvas.height = image.naturalHeight;

      const context = nextCanvas.getContext('2d');

      if (!context) {
        setError('No se pudo crear la vista previa.');
        setStats(null);
        return;
      }

      context.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
      context.drawImage(image, 0, 0);

      const imageData = context.getImageData(
        0,
        0,
        nextCanvas.width,
        nextCanvas.height,
      );

      const contour = extractAlphaContourMask(
        imageData,
        clampAlphaThreshold(alphaThreshold),
      );

      const polygon = extractLargestAlphaPolygon(
        imageData,
        clampAlphaThreshold(alphaThreshold),
        simplificationTolerancePx,
      );

      context.fillStyle = 'rgba(0, 229, 255, 1)';

      for (let y = 0; y < contour.height; y += 1) {
        for (let x = 0; x < contour.width; x += 1) {
          const index = y * contour.width + x;

          if (contour.edgeMask[index] !== 1) {
            continue;
          }

          context.fillRect(x - 2, y - 2, 5, 5);
        }
      }

      if (polygon && polygon.simplifiedPolygon.length >= 2) {
        const firstPoint = polygon.simplifiedPolygon[0];

        if (firstPoint) {
          context.beginPath();
          context.moveTo(firstPoint.x, firstPoint.y);

          for (
            let index = 1;
            index < polygon.simplifiedPolygon.length;
            index += 1
          ) {
            const point = polygon.simplifiedPolygon[index];

            if (!point) {
              continue;
            }

            context.lineTo(point.x, point.y);
          }

          context.closePath();
          context.strokeStyle = 'rgba(255, 0, 128, 1)';
          context.lineWidth = 4;
          context.stroke();
        }
      }

      setError(null);
      setStats({
        widthPx: contour.width,
        heightPx: contour.height,
        opaquePixelCount: contour.opaquePixelCount,
        edgePixelCount: contour.edgePixelCount,
        rawPolygonPoints: polygon?.rawPointCount ?? 0,
        simplifiedPolygonPoints: polygon?.simplifiedPointCount ?? 0,
      });
    };

    image.onerror = () => {
      if (cancelled) {
        return;
      }

      setError('No se pudo leer el PNG seleccionado.');
      setStats(null);
    };

    image.src = imageUrl;

    return () => {
      cancelled = true;
    };
  }, [imageUrl, alphaThreshold, simplificationTolerancePx]);

  if (!imageUrl) {
    return (
      <div className="template-preview empty">
        Cargá un PNG para ver el contorno detectado.
      </div>
    );
  }

  return (
    <>
      <div className="template-preview contour">
        <canvas ref={canvasRef} role="img" aria-label={label} />
      </div>

      {error ? <p className="image-metadata">{error}</p> : null}

      {stats ? (
        <div className="contour-stats">
          <span>Borde raster: {stats.edgePixelCount.toLocaleString()}</span>

          <span>
            Polígono original: {stats.rawPolygonPoints.toLocaleString()} puntos
          </span>

          <span>
            Polígono simplificado:{' '}
            {stats.simplifiedPolygonPoints.toLocaleString()} puntos
          </span>
        </div>
      ) : null}
    </>
  );
}
