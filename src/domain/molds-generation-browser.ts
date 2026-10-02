import type { GarmentSize } from './size';
import type { MoldOutputSpec } from './molds-generation';
import { appendSizeMarkPngMetadata } from './size-mark-metadata';
import {
  SIZE_MARK_MAX_EDGE_GAP_PX,
  createSizeMarkGlyph,
  measureSizeMarkEdgeGapPx,
  stampSizeMark,
  validateSizeMark,
  type SizeMarkBounds,
  type SizeMarkMask,
} from './size-mark-raster';

/** The pure shared glyph is shared by Moldes, bulk regeneration and validation. */
export function rasterizeMoldNumber(size: GarmentSize): SizeMarkMask {
  return createSizeMarkGlyph(size);
}

/** Avoid Canvas text compositing: putImageData preserves the resized alpha
 * while the pure compositor writes exact #8aff00 only on fully opaque pixels.
 */
export function addMoldNumber(context: CanvasRenderingContext2D, size: GarmentSize): SizeMarkBounds {
  const mask = rasterizeMoldNumber(size);
  const pixels = context.getImageData(0, 0, context.canvas.width, context.canvas.height);
  const placement = stampSizeMark(pixels, mask);
  context.putImageData(pixels, 0, 0);
  return placement;
}

/** Uses the same browser Canvas scaling and shared marker path as /Moldes. */
export async function renderMoldOutput(master: Blob, spec: MoldOutputSpec): Promise<Blob> {
  const bitmap = await createImageBitmap(master);
  try {
    return await renderMoldOutputFromBitmap(bitmap, spec);
  } finally {
    bitmap.close();
  }
}

/** Reuses one decoded source bitmap for all ten sizes of the same side. */
export async function renderMoldOutputFromBitmap(bitmap: ImageBitmap, spec: MoldOutputSpec): Promise<Blob> {
  const canvas = document.createElement('canvas');
  try {
    canvas.width = spec.widthPx;
    canvas.height = spec.heightPx;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No se pudo crear el canvas de generación.');
    context.clearRect(0, 0, spec.widthPx, spec.heightPx);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, spec.widthPx, spec.heightPx);
    const original = context.getImageData(0, 0, spec.widthPx, spec.heightPx);
    const originalAlpha = new Uint8Array(spec.widthPx * spec.heightPx);
    for (let pixel = 0, offset = 3; pixel < originalAlpha.length; pixel++, offset += 4) {
      originalAlpha[pixel] = original.data[offset]!;
    }
    const mask = rasterizeMoldNumber(spec.size);
    const placement = addMoldNumber(context, spec.size);
    const gapPx = measureSizeMarkEdgeGapPx(original, mask, placement);
    if (gapPx > SIZE_MARK_MAX_EDGE_GAP_PX) throw new Error(`Separación al borde local excesiva: ${gapPx}px.`);
    validateSizeMark(context.getImageData(0, 0, spec.widthPx, spec.heightPx), originalAlpha, mask, placement);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(result => result ? resolve(result) : reject(new Error('No se pudo codificar el PNG generado.')), 'image/png');
    });
    if (blob.type !== 'image/png' || blob.size > 32 * 1024 * 1024) {
      throw new Error('El PNG generado supera 32 MiB.');
    }
    const markedBlob = await appendSizeMarkPngMetadata(blob, {
      version: 1, size: spec.size, x: placement.x, y: placement.y,
      width: placement.width, height: placement.height,
    });
    const verificationBitmap = await createImageBitmap(markedBlob);
    try {
      if (verificationBitmap.width !== spec.widthPx || verificationBitmap.height !== spec.heightPx) {
        throw new Error('El PNG codificado no conserva las dimensiones planeadas.');
      }
      context.clearRect(0, 0, spec.widthPx, spec.heightPx);
      context.drawImage(verificationBitmap, 0, 0);
      validateSizeMark(context.getImageData(0, 0, spec.widthPx, spec.heightPx), originalAlpha, mask, placement);
    } finally {
      verificationBitmap.close();
    }
    return markedBlob;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
