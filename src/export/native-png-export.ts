import { Channel, invoke, isTauri } from '@tauri-apps/api/core';
import { preflightBatch, PX_PER_MM, type ExportLayout, type PreparedBatch } from './export-plan';
import { rotatePoint } from '../geometry/polygon-transform';
import { prepareExportSourceBlob, sourceCropKey } from './export-source-crop';
import { createSizeMarkGlyph, type SizeMarkMask } from '../domain/size-mark-raster';
import { readSizeMarkPngMetadata, type SizeMarkPngMetadata } from '../domain/size-mark-metadata';

const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
export interface NativePngPlan {
  laserOutline?: { width: number; contours: number[][][] };
  sizeMarkMasks?: { width: number; height: number; data: number[] }[];
  sizeMarks?: { pieceIndex: number; source: number; x: number; y: number; maskIndex: number; contourIndices: number[] }[];
  /** Exact PDF page size; raster coordinates still use fixed 300 PPI. Laser only. */
  pageWidthMm?: number;
  pageHeightMm?: number;
  name: string;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  pieces: { source: number; translateX: number; translateY: number; width: number; height: number; rotation: number }[];
}
export interface NativeRenderDiagnostics {
    name: string;
    width: number;
    height: number;
    outputBytes: number;
    compositionMs: number;
rgbConvertMs: number;
encodeWriteMs: number;
    totalMs: number;
    strips: number;
    pieceDraws: number;
    decodedSources: number;
    decodedBytes: number;
    rasterWorkingBytes: number;
}
export interface PngExportDiagnostics {
  /** Fetch/hash + IPC/decode; decodeMs is a subset measured in Rust. */
  sourcePreparationTransferMs: number;
  decodeMs: number;
  totalMs: number;
  ipcCalls: number;
  sourceUploads: number;
  sourceBytes: number;
  layouts: NativeRenderDiagnostics[];
}
export type NativeSizeMarkSources = ReadonlyMap<string, SizeMarkPngMetadata>;

export function nativePngPlan(
  layout: ExportLayout,
  sources: ReadonlyMap<string, number>,
  sizeMarkSources?: NativeSizeMarkSources,
): NativePngPlan {
  if (layout.laserOutline && layout.pieces.some(art => !art.cutComponents?.length)) {
    throw new Error('Falta el contorno de corte para la exportación láser.');
  }
  const laserContours: number[][][] = [];
  const contourIndicesByPiece = layout.pieces.map(art => {
    const indexes: number[] = [];
    for (const component of art.cutComponents ?? []) {
      indexes.push(laserContours.length);
      laserContours.push(component.map(vertex =>
        [(vertex.x - layout.offsetX) * PX_PER_MM, (vertex.y - layout.offsetY) * PX_PER_MM]));
    }
    return indexes;
  });
  const masks: { width: number; height: number; data: number[] }[] = [];
  const maskIndexBySize = new Map<string, number>();
  const markers: NonNullable<NativePngPlan['sizeMarks']> = [];
  if (layout.laserOutline && sizeMarkSources) {
    layout.pieces.forEach((art, pieceIndex) => {
      const metadata = sizeMarkSources.get(art.definition.id);
      if (!metadata || art.definition.kind === 'free-png') return;
      if (metadata.size !== art.definition.size || metadata.height !== 18) {
        throw new Error(`Metadata del marcador no coincide con ${art.definition.fileName}.`);
      }
      const mask = createSizeMarkGlyph(metadata.size) as SizeMarkMask;
      if (mask.width !== metadata.width || mask.height !== metadata.height) {
        throw new Error(`Dimensiones de la máscara del marcador inválidas: ${art.definition.fileName}.`);
      }
      const crop = art.sourceCrop;
      const x = metadata.x - (crop?.xPx ?? 0);
      const y = metadata.y - (crop?.yPx ?? 0);
      if (x < 0 || y < 0 || x + mask.width > (crop?.widthPx ?? art.definition.sourceWidthPx) ||
          y + mask.height > (crop?.heightPx ?? art.definition.sourceHeightPx)) {
        throw new Error(`El recorte de exportación excluye el marcador: ${art.definition.fileName}.`);
      }
      if (!contourIndicesByPiece[pieceIndex]?.length) {
        throw new Error(`Falta el contorno para clippear el marcador: ${art.definition.fileName}.`);
      }
      let maskIndex = maskIndexBySize.get(metadata.size);
      if (maskIndex === undefined) {
        maskIndex = masks.length;
        maskIndexBySize.set(metadata.size, maskIndex);
        masks.push({ width: mask.width, height: mask.height, data: Array.from(mask.data) });
      }
      const source = sources.get(art.definition.id);
      if (source === undefined) throw new Error('Fuente no preparada: ' + art.definition.fileName);
      markers.push({ pieceIndex, source, x, y, maskIndex, contourIndices: contourIndicesByPiece[pieceIndex]! });
    });
  }
  return {
    ...(layout.laserOutline ? { pageWidthMm: layout.widthMm, pageHeightMm: layout.heightMm } : {}),
    ...(layout.laserOutline ? {laserOutline:{width:layout.laserOutline.widthMm*PX_PER_MM,
      contours:laserContours}} : {}),
    ...(markers.length ? { sizeMarkMasks: masks, sizeMarks: markers } : {}),
    name: layout.name, width: layout.widthPx, height: layout.heightPx,
    offsetX: layout.offsetX * PX_PER_MM, offsetY: layout.offsetY * PX_PER_MM,
    pieces: layout.pieces.map(art => {
      const source = sources.get(art.definition.id);
      if (source === undefined) throw new Error('Fuente no preparada: ' + art.definition.fileName);
      const crop = art.sourceCrop;
      const origin = crop
        ? rotatePoint({ x: crop.xMm, y: crop.yMm }, art.placement.rotation)
        : { x: 0, y: 0 };
      return { source, translateX: (art.translateX + origin.x) * PX_PER_MM, translateY: (art.translateY + origin.y) * PX_PER_MM,
        width: (crop?.widthMm ?? art.definition.physicalWidthMm) * PX_PER_MM, height: (crop?.heightMm ?? art.definition.physicalHeightMm) * PX_PER_MM,
        rotation: art.placement.rotation };
    }),
  };
}

export async function exportBatchPng(
  batch: PreparedBatch,
  signal: AbortSignal,
  progress: (text: string) => void,
  reportDiagnostics?: (diagnostics: PngExportDiagnostics) => void,
): Promise<string[]> {
  if (!isTauri()) throw new Error('La exportación a disco requiere la aplicación Windows. Abrí Nestra con npm run tauri dev.');
  signal.throwIfAborted();
  const start = performance.now();
  const report = preflightBatch(batch);
  if (report.errors.length) throw new Error(report.errors.join('\n'));
  const diagnostics: PngExportDiagnostics = { sourcePreparationTransferMs: 0, decodeMs: 0, totalMs: 0,
    ipcCalls: 0, sourceUploads: 0, sourceBytes: 0, layouts: [] };
  const paths: string[] = [];
  let session: string | undefined;
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    if (!session) return Promise.resolve();
    if (!closing) {
      diagnostics.ipcCalls++;
      closing = invoke<void>('close_native_export', { id: session });
    }
    return closing;
  };
  const abort = () => { void close().catch(() => undefined); };
  try {
  signal.throwIfAborted();

  diagnostics.ipcCalls++;

  const folderSelected = await invoke<boolean>(
    'choose_export_folder',
  );

  if (!folderSelected) {
    return paths;
  }

  signal.throwIfAborted();

  diagnostics.ipcCalls++;

  session = await invoke<string>('begin_native_export');
    signal.addEventListener('abort', abort, { once: true });
    signal.throwIfAborted();
    const preparation = performance.now();
    const sources = new Map<string, number>();
    const urls = new Map<string, { source: number; width: number; height: number }>();
    const marksBySourceCrop = new Map<string, SizeMarkPngMetadata>();
    const hashes = new Map<string, { source: number; width: number; height: number }>();
    const sizeMarkSources = new Map<string, SizeMarkPngMetadata>();
    const artworks = new Map(report.layouts.flatMap(layout => layout.pieces.map(art => [art.definition.id, art] as const)));
    for (const art of artworks.values()) {
      const d = art.definition;
      signal.throwIfAborted();
      const cacheKey = sourceCropKey(d, art.sourceCrop);
      const reused = urls.get(cacheKey);
      if (reused) {
        sources.set(d.id, reused.source);
        const reusedMark = marksBySourceCrop.get(cacheKey);
        if (reusedMark) {
          if (d.kind === 'free-png' || reusedMark.size !== d.size) throw new Error('Metadata de marcador incompatible con la pieza: ' + d.fileName);
          sizeMarkSources.set(d.id, reusedMark);
        }
        continue;
      }
      progress('Preparando PNG fuente · ' + (sources.size + 1) + '/' + artworks.size);
      // File/IndexedDB assets have object URLs, not filesystem paths. Only their
      // compressed bytes cross IPC, once per content hash, without base64/JSON.
      const response = await fetch(d.imageUrl, { signal });
      if (!response.ok) throw new Error('No se pudo leer ' + d.fileName);
      const original = await response.blob();
      if (!original.size || original.size > MAX_SOURCE_BYTES) throw new Error('El PNG fuente debe ocupar como máximo 64 MiB: ' + d.fileName);
      const mark = readSizeMarkPngMetadata(new Uint8Array(await original.arrayBuffer()));
      if (mark) {
        if (d.kind === 'free-png' || mark.size !== d.size || mark.x + mark.width > d.sourceWidthPx ||
            mark.y + mark.height > d.sourceHeightPx) {
          throw new Error('Metadata de marcador incompatible con la pieza: ' + d.fileName);
        }
        sizeMarkSources.set(d.id, mark);
        marksBySourceCrop.set(cacheKey, mark);
      }
      const prepared = await prepareExportSourceBlob(
        original,
        d,
        art.sourceCrop,
        signal,
        mark,
      );
      const bytes = await prepared.blob.arrayBuffer();
      if (!bytes.byteLength || bytes.byteLength > MAX_SOURCE_BYTES) throw new Error('La fuente PNG recortada debe ocupar como máximo 64 MiB: ' + d.fileName);
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      signal.throwIfAborted();
      let source = hashes.get(hash);
      if (source && (source.width !== prepared.width || source.height !== prepared.height)) throw new Error('Dimensiones de fuente inconsistentes.');
      if (!source) {
        source = { source: hashes.size, width: prepared.width, height: prepared.height };
        diagnostics.ipcCalls++;
        const decoded = await invoke<{ decodeMs: number }>('upload_png_source', bytes, { headers: {
          'x-nestra-session': session, 'x-nestra-source': String(source.source),
          'x-nestra-width': String(source.width), 'x-nestra-height': String(source.height),
        } });
        diagnostics.sourceUploads++;
        diagnostics.sourceBytes += bytes.byteLength;
        diagnostics.decodeMs += decoded.decodeMs;
        hashes.set(hash, source);
      }
      urls.set(cacheKey, source);
      sources.set(d.id, source.source);
    }
    diagnostics.sourcePreparationTransferMs = performance.now() - preparation;
    for (const [index, layout] of report.layouts.entries()) {
  while (true) {
    signal.throwIfAborted();

    progress(
      `Preparando Canvas ${index + 1}/${report.layouts.length}`,
    );

    diagnostics.ipcCalls++;

    const destination = await invoke<string>(
      'resolve_export_destination',
      {
        suggestedName: layout.name,
      },
    );

    const channel = new Channel<number>();

    channel.onmessage = (percent) => {
      if (!signal.aborted) {
        progress(
          `Canvas ${index + 1}/${report.layouts.length} · ${percent}%`,
        );
      }
    };

    progress(
      `Canvas ${index + 1}/${report.layouts.length} · 0%`,
    );

    diagnostics.ipcCalls++;

    try {
      const result = await invoke<{
        path: string;
        diagnostics: NativeRenderDiagnostics;
      }>('render_native_png', {
        id: session,
        plan: nativePngPlan(layout, sources, sizeMarkSources),
        destination,
        progress: channel,
      });

      paths.push(result.path);
      diagnostics.layouts.push(result.diagnostics);

      break;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('Ya existe ese archivo')
      ) {
        /*
         * Puede existir una carrera extremadamente pequeña entre
         * resolver el nombre y publicar el archivo. Recalculamos
         * otro sufijo automáticamente, nunca sobrescribimos.
         */
        continue;
      }

      throw error;
    }
  }
}
    signal.throwIfAborted();
    return paths;
  } catch (error) {
    throw new Error((error instanceof Error ? error.message : String(error)) +
      (paths.length ? '\nYa guardados: ' + paths.join(', ') : ''), { cause: error });
  } finally {
    signal.removeEventListener('abort', abort);
    await close();
    diagnostics.totalMs = performance.now() - start;
    reportDiagnostics?.(diagnostics);
  }
}
