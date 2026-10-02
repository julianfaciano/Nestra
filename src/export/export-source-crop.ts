import type { BatchPieceDefinition } from '../domain/production-batch';
import { createSizeMarkGlyph, SIZE_MARK_CUT_ALPHA_THRESHOLD, SIZE_MARK_RGB } from '../domain/size-mark-raster';
import type { SizeMarkPngMetadata } from '../domain/size-mark-metadata';
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

/** Removes the embedded source-green glyph before the post-stroke overlay is rendered. */
export function suppressEmbeddedSizeMark(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  metadata: SizeMarkPngMetadata,
  cropX = 0,
  cropY = 0,
): Uint8ClampedArray {
  if (pixels.length !== width * height * 4) throw new Error('Raster inválido al suprimir el marcador embebido.');
  const mask = createSizeMarkGlyph(metadata.size);
  const x0 = metadata.x - cropX;
  const y0 = metadata.y - cropY;
  if (mask.width !== metadata.width || mask.height !== metadata.height || x0 < 0 || y0 < 0 ||
      x0 + mask.width > width || y0 + mask.height > height) {
    throw new Error('El recorte excluye el marcador de talle.');
  }
  const result = new Uint8ClampedArray(pixels);
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (mask.data[y * mask.width + x] === 0) continue;
      const offset = ((y0 + y) * width + x0 + x) * 4;
      if (result[offset + 3]! <= SIZE_MARK_CUT_ALPHA_THRESHOLD) {
        throw new Error('El marcador embebido sale del alpha de corte >16.');
      }
      const alpha = result[offset + 3]!;
      if (!SIZE_MARK_RGB_KEYS.every((channel, index) =>
        matchesCanvasPremultiplication(result[offset + index]!, channel, alpha))) {
        throw new Error(`El PNG original no coincide con la máscara #8aff00 de metadata (${metadata.size}).`);
      }
      result[offset] = 255;
      result[offset + 1] = 255;
      result[offset + 2] = 255;
    }
  }
  return result;
}

const SIZE_MARK_RGB_KEYS = [SIZE_MARK_RGB.red, SIZE_MARK_RGB.green, SIZE_MARK_RGB.blue] as const;

function matchesCanvasPremultiplication(observed: number, expected: number, alpha: number): boolean {
  if (Math.round(observed * alpha / 255) === Math.round(expected * alpha / 255)) return true;

  // WebView2's default Canvas path can floor the premultiplied 8-bit channel,
  // then round while unpremultiplying getImageData(). Accept only that exact
  // round-trip value in addition to the nearest-rounding path above.
  const premultipliedFloor = Math.floor(expected * alpha / 255);
  const floorRoundTrip = Math.round(premultipliedFloor * 255 / alpha);
  return observed === floorRoundTrip;
}

export async function prepareExportSourceBlob(
  blob: Blob,
  definition: BatchPieceDefinition,
  crop: SourceCrop | undefined,
  signal: AbortSignal,
  sizeMark?: SizeMarkPngMetadata,
): Promise<{ readonly blob: Blob; readonly width: number; readonly height: number }> {
  const full =
    !crop ||
    (crop.xPx === 0 &&
      crop.yPx === 0 &&
      crop.widthPx === definition.sourceWidthPx &&
      crop.heightPx === definition.sourceHeightPx);
  if (full && !sizeMark) {
    return {
      blob,
      width: definition.sourceWidthPx,
      height: definition.sourceHeightPx,
    };
  }

  signal.throwIfAborted();
  const sourceCrop = crop ?? {
    xPx: 0,
    yPx: 0,
    widthPx: definition.sourceWidthPx,
    heightPx: definition.sourceHeightPx,
  };
  const bitmap = await createImageBitmap(
    blob,
    sourceCrop.xPx,
    sourceCrop.yPx,
    sourceCrop.widthPx,
    sourceCrop.heightPx,
    {
      imageOrientation: 'none',
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    },
  );
  const canvas = document.createElement('canvas');
  canvas.width = sourceCrop.widthPx;
  canvas.height = sourceCrop.heightPx;

  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No se pudo recortar la fuente PNG.');
    context.drawImage(bitmap, 0, 0);
    signal.throwIfAborted();
    if (sizeMark) {
      const image = context.getImageData(0, 0, sourceCrop.widthPx, sourceCrop.heightPx);
      image.data.set(suppressEmbeddedSizeMark(
        image.data,
        sourceCrop.widthPx,
        sourceCrop.heightPx,
        sizeMark,
        sourceCrop.xPx,
        sourceCrop.yPx,
      ));
      context.putImageData(image, 0, 0);
    }
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
    return { blob: cropped, width: sourceCrop.widthPx, height: sourceCrop.heightPx };
  } finally {
    bitmap.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}
