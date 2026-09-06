import { invoke, isTauri } from '@tauri-apps/api/core';
import { preflightBatch, PX_PER_MM, type ExportLayout, type PreparedBatch } from './export-plan';

export const STRIP_ROWS = 64;
export const MAX_SOURCE_PIXELS = 16_000_000;
const MAX_DECODED_BYTES = 128 * 1024 * 1024;

async function loadImages(batch: PreparedBatch): Promise<Map<string, ImageBitmap>> {
  const images = new Map<string, ImageBitmap>();
  let memory = 0;
  try {
    for (const d of batch.definitions) {
      memory += d.sourceWidthPx * d.sourceHeightPx * 4;
      if (d.sourceWidthPx * d.sourceHeightPx > MAX_SOURCE_PIXELS || memory > MAX_DECODED_BYTES) throw new Error('Los PNG fuente exceden el presupuesto de 128 MiB decodificados (16 MP por imagen). Dividí el batch.');
      const blob = await (await fetch(d.imageUrl)).blob();
      const image = await createImageBitmap(blob);
      images.set(d.id, image);
      if (image.width !== d.sourceWidthPx || image.height !== d.sourceHeightPx) throw new Error('Cambió el tamaño del PNG: ' + d.fileName);
    }
    return images;
  } catch (error) { for (const image of images.values()) image.close(); throw error; }
}

export function drawStrip(context: CanvasRenderingContext2D, layout: ExportLayout, images: ReadonlyMap<string, CanvasImageSource>, y: number, rows: number): void {
  context.resetTransform();
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, layout.widthPx, rows);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  for (const art of layout.pieces) {
    const image = images.get(art.definition.id);
    if (!image) throw new Error('Imagen no disponible: ' + art.definition.fileName);
    context.save();
    context.translate(-layout.offsetX * PX_PER_MM, -layout.offsetY * PX_PER_MM - y);
    context.translate(art.translateX * PX_PER_MM, art.translateY * PX_PER_MM);
    context.rotate(art.placement.rotation * Math.PI / 180);
    context.drawImage(image, 0, 0, art.definition.physicalWidthMm * PX_PER_MM, art.definition.physicalHeightMm * PX_PER_MM);
    context.restore();
  }
}

export async function exportBatchPngLegacy(batch: PreparedBatch, signal: AbortSignal, progress: (text: string) => void): Promise<string[]> {
  if (!isTauri()) throw new Error('La exportación a disco requiere la aplicación Windows. Abrí Nestra con npm run tauri dev.');
  const report = preflightBatch(batch);
  if (report.errors.length) throw new Error(report.errors.join('\n'));
  const paths: string[] = [];
  const images = await loadImages(batch);
  let session: string | undefined;
  const canvas = document.createElement('canvas');
  try {
    if (!await invoke<boolean>('choose_export_folder')) return paths;
    for (const [index, layout] of report.layouts.entries()) {
      signal.throwIfAborted();
      canvas.width = layout.widthPx; canvas.height = STRIP_ROWS;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('No se pudo crear la franja de render.');
      session = await invoke<string>('begin_png', { name:layout.name, width:layout.widthPx, height:layout.heightPx });
      let offset = 0;
      for (let y = 0; y < layout.heightPx; y += STRIP_ROWS) {
        signal.throwIfAborted();
        const rows = Math.min(STRIP_ROWS, layout.heightPx - y);
        drawStrip(context, layout, images, y, rows);
        const rgba = context.getImageData(0, 0, layout.widthPx, rows).data;
        const rgb = new Uint8Array(layout.widthPx * rows * 3);
        for (let i = 0, j = 0; i < rgba.length; i += 4) { rgb[j++] = rgba[i]!; rgb[j++] = rgba[i+1]!; rgb[j++] = rgba[i+2]!; }
        await invoke('write_png_strip', rgb, { headers: { 'x-nestra-session': session, 'x-nestra-offset': String(offset) } });
        offset += rgb.length;
        progress('Canvas ' + (index+1) + '/' + report.layouts.length + ' · ' + Math.round((y+rows)/layout.heightPx*100) + '%');
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      paths.push(await invoke<string>('finish_png', { id:session }));
      session = undefined;
    }
    return paths;
  } catch (error) {
    if (session) await invoke('abort_png', { id:session }).catch(() => undefined);
    throw new Error((error instanceof Error ? error.message : String(error)) + (paths.length ? '\nYa guardados: ' + paths.join(', ') : ''), { cause: error });
  } finally {
    canvas.width = 0; canvas.height = 0;
    for (const image of images.values()) image.close();
  }
}


export { exportBatchPng } from './native-png-export';

