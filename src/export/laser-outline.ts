import type { ExportLayout } from './export-plan';
/** World-mm contours shared by canvas previews, strip PNG, native PNG and PDF. */
export function drawLaserOutlines(
  context: CanvasRenderingContext2D,
  layout: ExportLayout,
  scale: number,
  stripY = 0,
): void {
  if (!layout.laserOutline) return;
  context.save();
  context.globalAlpha = 1;
  context.globalCompositeOperation = 'source-over';
  context.translate(-layout.offsetX * scale, -layout.offsetY * scale - stripY);
  context.strokeStyle = layout.laserOutline.color;
  context.lineWidth = layout.laserOutline.widthMm * scale;
  context.lineJoin = 'round';
  context.lineCap = 'round';
  for (const art of layout.pieces)
    for (const p of art.cutComponents ?? []) {
      if (!p.length) continue;
      context.beginPath();
      context.moveTo(p[0]!.x * scale, p[0]!.y * scale);
      for (const v of p.slice(1)) context.lineTo(v.x * scale, v.y * scale);
      context.closePath();
      context.stroke();
    }
  context.restore();
}
