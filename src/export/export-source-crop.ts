import type { BatchPieceDefinition } from '../domain/production-batch';
import type { SourceCrop } from './export-plan';

export function sourceCropKey(
  definition: BatchPieceDefinition,
  crop?: SourceCrop,
): string {
  return [
    definition.imageUrl,
    crop?.xPx ?? 0,
    crop?.yPx ?? 0,
    crop?.widthPx ?? definition.sourceWidthPx,
    crop?.heightPx ?? definition.sourceHeightPx,
  ].join('|');
}

export async function prepareExportSourceBlob(
  blob: Blob,
  definition: BatchPieceDefinition,
  crop: SourceCrop | undefined,
  signal: AbortSignal,
): Promise<{ readonly blob: Blob; readonly width: number; readonly height: number }> {
  const full =
    !crop ||
    (crop.xPx === 0 &&
      crop.yPx === 0 &&
      crop.widthPx === definition.sourceWidthPx &&
      crop.heightPx === definition.sourceHeightPx);
  if (full) {
    return {
      blob,
      width: definition.sourceWidthPx,
      height: definition.sourceHeightPx,
    };
  }

  signal.throwIfAborted();
  const bitmap = await createImageBitmap(
    blob,
    crop.xPx,
    crop.yPx,
    crop.widthPx,
    crop.heightPx,
    {
      imageOrientation: 'none',
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    },
  );
  const canvas = document.createElement('canvas');
  canvas.width = crop.widthPx;
  canvas.height = crop.heightPx;

  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No se pudo recortar la fuente PNG.');
    context.drawImage(bitmap, 0, 0);
    signal.throwIfAborted();
    const cropped = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (value) =>
          value
            ? resolve(value)
            : reject(new Error('No se pudo codificar la fuente PNG recortada.')),
        'image/png',
      );
    });
    signal.throwIfAborted();
    return { blob: cropped, width: crop.widthPx, height: crop.heightPx };
  } finally {
    bitmap.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}
