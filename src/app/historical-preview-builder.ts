import {
  PX_PER_MM,
  type ExportLayout,
} from '../export/export-plan';

import {
  saveHistoricalPreview,
} from '../persistence/historical-preview-cache';

import type {
  HistoricalFile,
} from '../persistence/historical-jobs';

const MAX_PREVIEW_PX = 900;
const JPEG_QUALITY = 0.78;

function loadImage(
  url: string,
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.decoding = 'async';

    image.onload = () => resolve(image);

    image.onerror = () =>
      reject(
        new Error(
          'No se pudo preparar una imagen para el preview histórico.',
        ),
      );

    image.src = url;
  });
}

function canvasToJpeg(
  canvas: HTMLCanvasElement,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(
            new Error(
              'No se pudo generar el preview histórico.',
            ),
          );
          return;
        }

        resolve(blob);
      },
      'image/jpeg',
      JPEG_QUALITY,
    );
  });
}

async function renderLayoutPreview(
  layout: ExportLayout,
  imageCache: Map<
    string,
    Promise<HTMLImageElement>
  >,
  signal: AbortSignal,
): Promise<Blob> {
  signal.throwIfAborted();

  const scale = Math.min(
    1,
    MAX_PREVIEW_PX / layout.widthPx,
    MAX_PREVIEW_PX / layout.heightPx,
  );

  const canvas =
    document.createElement('canvas');

  canvas.width = Math.max(
    1,
    Math.round(layout.widthPx * scale),
  );

  canvas.height = Math.max(
    1,
    Math.round(layout.heightPx * scale),
  );

  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error(
      'No se pudo crear el preview histórico.',
    );
  }

  context.fillStyle = '#ffffff';

  context.fillRect(
    0,
    0,
    canvas.width,
    canvas.height,
  );

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';

  const pixelScale =
    PX_PER_MM * scale;

  for (const art of layout.pieces) {
    signal.throwIfAborted();

    let imagePromise =
      imageCache.get(
        art.definition.imageUrl,
      );

    if (!imagePromise) {
      imagePromise = loadImage(
        art.definition.imageUrl,
      );

      imageCache.set(
        art.definition.imageUrl,
        imagePromise,
      );
    }

    const image = await imagePromise;

    signal.throwIfAborted();

    context.save();

    context.translate(
      (
        art.translateX -
        layout.offsetX
      ) * pixelScale,

      (
        art.translateY -
        layout.offsetY
      ) * pixelScale,
    );

    context.rotate(
      art.placement.rotation *
        Math.PI /
        180,
    );

    context.drawImage(
      image,
      0,
      0,

      art.definition.physicalWidthMm *
        pixelScale,

      art.definition.physicalHeightMm *
        pixelScale,
    );

    context.restore();
  }

  signal.throwIfAborted();

  return canvasToJpeg(canvas);
}

export async function buildHistoricalBatchPreviewFiles(
  layouts: readonly ExportLayout[],
  signal: AbortSignal,
): Promise<HistoricalFile[]> {
  const files: HistoricalFile[] = [];

  const imageCache = new Map<
    string,
    Promise<HTMLImageElement>
  >();

  for (
    let index = 0;
    index < layouts.length;
    index += 1
  ) {
    signal.throwIfAborted();

    const layout = layouts[index];

    if (!layout) {
      continue;
    }

    try {
      const blob =
        await renderLayoutPreview(
          layout,
          imageCache,
          signal,
        );

      signal.throwIfAborted();

      const thumbnailKey =
        `nestra:${crypto.randomUUID()}`;

      await saveHistoricalPreview(
        thumbnailKey,
        blob,
      );

      files.push({
        name: layout.name,

        path: thumbnailKey,

        size: blob.size,

        type: 'canvas',

        widthPx: layout.widthPx,

        heightPx: layout.heightPx,

        physicalWidthCm:
          layout.widthMm / 10,

        physicalHeightCm:
          layout.heightMm / 10,

        thumbnailKey,
      });
    } catch {
      /*
       * Un preview fallido no puede hacer
       * fallar una optimización válida.
       */
      signal.throwIfAborted();
    }

    /*
     * Dejamos respirar a WebView2 cada
     * pocos canvases.
     */
    if ((index + 1) % 4 === 0) {
      await new Promise<void>(
        (resolve) => {
          window.setTimeout(
            resolve,
            0,
          );
        },
      );
    }
  }

  return files;
}