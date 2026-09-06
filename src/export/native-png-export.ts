import { Channel, invoke, isTauri } from '@tauri-apps/api/core';
import { preflightBatch, PX_PER_MM, type ExportLayout, type PreparedBatch } from './export-plan';

const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
export interface NativePngPlan {
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
export function nativePngPlan(layout: ExportLayout, sources: ReadonlyMap<string, number>): NativePngPlan {
  return {
    name: layout.name, width: layout.widthPx, height: layout.heightPx,
    offsetX: layout.offsetX * PX_PER_MM, offsetY: layout.offsetY * PX_PER_MM,
    pieces: layout.pieces.map(art => {
      const source = sources.get(art.definition.id);
      if (source === undefined) throw new Error('Fuente no preparada: ' + art.definition.fileName);
      return { source, translateX: art.translateX * PX_PER_MM, translateY: art.translateY * PX_PER_MM,
        width: art.definition.physicalWidthMm * PX_PER_MM, height: art.definition.physicalHeightMm * PX_PER_MM,
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
    const hashes = new Map<string, { source: number; width: number; height: number }>();
    const definitions = new Map(report.layouts.flatMap(layout => layout.pieces.map(art => [art.definition.id, art.definition] as const)));
    for (const d of definitions.values()) {
      signal.throwIfAborted();
      const reused = urls.get(d.imageUrl);
      if (reused) {
        if (reused.width !== d.sourceWidthPx || reused.height !== d.sourceHeightPx) throw new Error('Dimensiones de fuente inconsistentes.');
        sources.set(d.id, reused.source);
        continue;
      }
      progress('Preparando PNG fuente · ' + (sources.size + 1) + '/' + definitions.size);
      // File/IndexedDB assets have object URLs, not filesystem paths. Only their
      // compressed bytes cross IPC, once per content hash, without base64/JSON.
      const response = await fetch(d.imageUrl, { signal });
      if (!response.ok) throw new Error('No se pudo leer ' + d.fileName);
      const blob = await response.blob();
      if (!blob.size || blob.size > MAX_SOURCE_BYTES) throw new Error('El PNG fuente debe ocupar como máximo 64 MiB: ' + d.fileName);
      const bytes = await blob.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      signal.throwIfAborted();
      let source = hashes.get(hash);
      if (source && (source.width !== d.sourceWidthPx || source.height !== d.sourceHeightPx)) throw new Error('Dimensiones de fuente inconsistentes.');
      if (!source) {
        source = { source: hashes.size, width: d.sourceWidthPx, height: d.sourceHeightPx };
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
      urls.set(d.imageUrl, source);
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
        plan: nativePngPlan(layout, sources),
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
