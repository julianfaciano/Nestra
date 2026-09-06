import { useEffect, useRef } from 'react';
import type { MultiNestingLayout } from '../geometry/multi-piece-nesting-engine';

const VIEW_WIDTH_PX = 740;

interface BatchLayoutPreviewProps {
  readonly layout: MultiNestingLayout;
  readonly fabric: string;
  readonly canvasWidthMm: number;
  readonly canvasHeightMm: number;
}

export function BatchLayoutPreview({
  layout,
  fabric,
  canvasWidthMm,
  canvasHeightMm,
}: BatchLayoutPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

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
    canvas.height = Math.round(
      (VIEW_WIDTH_PX * canvasHeightMm) / canvasWidthMm,
    );

    context.clearRect(0, 0, canvas.width, canvas.height);

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.strokeStyle = '#cbd5e1';
    context.lineWidth = 1;
    context.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);

    const scaleX = VIEW_WIDTH_PX / canvasWidthMm;
    const scaleY = canvas.height / canvasHeightMm;

    for (const piece of layout.pieces) {
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

      context.fillStyle = 'rgba(59, 130, 246, 0.16)';
      context.strokeStyle = '#2563eb';
      context.lineWidth = 1.5;

      context.fill();
      context.stroke();
    }
  }, [layout, canvasWidthMm, canvasHeightMm]);

  return (
    <div className="batch-layout-card">
      <div className="batch-layout-heading">
        <div>
          <strong>
            {fabric} · Canvas {layout.index + 1}
          </strong>

          <span>
            {layout.pieces.length} piezas · {(layout.usedWidth / 10).toFixed(2)}{' '}
            × {(layout.usedHeight / 10).toFixed(2)} cm
          </span>
        </div>
      </div>

      <canvas ref={canvasRef} className="physical-canvas" />
    </div>
  );
}
