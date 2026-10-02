import {
  invoke,
  isTauri,
} from '@tauri-apps/api/core';

import {
  preflightBatch,
  type PreparedBatch,
  type PreflightReport,
} from './export-plan';

import { nativePngPlan } from './native-png-export';
import { prepareExportSourceBlob } from './export-source-crop';
import { readSizeMarkPngMetadata, type SizeMarkPngMetadata } from '../domain/size-mark-metadata';

interface PdfDiagnostics {
  readonly path: string;
  readonly pagePt: [number, number];
  readonly pageCm: [number, number];
  readonly placements: number;
  readonly uniqueSources: number;
  readonly imageXobjects: number;
  readonly softMasks: number;
  readonly outputBytes: number;
  readonly totalMs: number;
}

export async function exportPdfPrototype(
  batch: PreparedBatch,
  signal: AbortSignal,
  progress: (status: string) => void,
  preparedReport?: PreflightReport,
): Promise<string[]> {
  if (!isTauri()) {
    throw new Error(
      'El PDF requiere Nestra Windows.',
    );
  }

  const report = preparedReport ?? preflightBatch(batch);

  if (report.errors.length > 0) {
    throw new Error(
      report.errors.join('\n'),
    );
  }

  if (report.layouts.length === 0) {
    throw new Error(
      'No hay canvas exportable.',
    );
  }

  signal.throwIfAborted();

  let id: string | null = null;
  let stage = 'abrir el selector de destino';
  let context = '';
  let failed = false;
  const started = performance.now();

  try {
    id = await invoke<string | null>(
      'begin_pdf_prototype',
      {
        name: 'pdf',
      },
    );

    if (!id) return [];

    const hashes =
      new Map<
        string,
        {
          source: number;
          width: number;
          height: number;
        }
      >();

    const sources =
      new Map<string, number>();
    const sizeMarkSources = new Map<string, SizeMarkPngMetadata>();
    const markedSourceLabels = new Map<number, Set<string>>();

    const artworks =
      new Map(
        report.layouts
          .flatMap(
            (layout) =>
              layout.pieces,
          )
          .map((piece) => [
            piece.definition.id,
            piece,
          ]),
      );

    for (
      const artwork
      of artworks.values()
    ) {
      const definition = artwork.definition;
      signal.throwIfAborted();

      const canvasIndex = report.layouts.findIndex((layout) =>
        layout.pieces.some((piece) => piece.definition.id === definition.id));
      const sourceLabel = definition.kind === 'free-png'
        ? definition.fileName
        : `${definition.model} ${definition.size} ${definition.side} · ${definition.fileName}`;
      context = `canvas ${canvasIndex + 1}/${report.layouts.length}; sourceId=${definition.id}; ${sourceLabel}`;

      progress(
        `Preparando fuentes PDF (${hashes.size})…`,
      );

      stage = 'fetch de la fuente';
      const response =
        await fetch(
          definition.imageUrl,
        );

      if (!response.ok) {
        throw new Error(
          `No se pudo leer ${definition.fileName}.`,
        );
      }

      stage = 'lectura del Blob de origen';
      const original =
        typeof response.blob === 'function'
          ? await response.blob()
          : new Blob([await response.arrayBuffer()], { type: 'image/png' });

      if (
        original.size === 0 ||
        original.size > 64 * 1024 * 1024
      ) {
        throw new Error(
          'Fuente fuera del límite de 64 MiB.',
        );
      }

      stage = 'validación de metadata del marcador';
      const mark = readSizeMarkPngMetadata(new Uint8Array(await original.arrayBuffer()));
      if (mark) {
        if (definition.kind === 'free-png' || mark.size !== definition.size ||
            mark.x + mark.width > definition.sourceWidthPx || mark.y + mark.height > definition.sourceHeightPx) {
          throw new Error(`Metadata de marcador incompatible con ${definition.fileName}.`);
        }
        sizeMarkSources.set(definition.id, mark);
      }

      let prepared: Awaited<ReturnType<typeof prepareExportSourceBlob>>;
      stage = 'limpieza y preparación de la fuente';
      try {
        prepared = await prepareExportSourceBlob(
          original,
          definition,
          artwork.sourceCrop,
          signal,
          mark,
        );
      } catch (error) {
        throw new Error(`${sourceLabel}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }

      stage = 'lectura de la fuente preparada';
      const bytes =
        await prepared.blob.arrayBuffer();

      if (
        bytes.byteLength === 0 ||
        bytes.byteLength >
          64 * 1024 * 1024
      ) {
        throw new Error(
          'Fuente fuera del límite de 64 MiB.',
        );
      }

      stage = 'cálculo SHA-256';
      const digest =
        await crypto.subtle.digest(
          'SHA-256',
          bytes,
        );

      const hash =
        Array.from(
          new Uint8Array(digest),
          (byte) =>
            byte
              .toString(16)
              .padStart(2, '0'),
        ).join('');

      const previous =
        hashes.get(hash);

      if (
        previous &&
        (
          previous.width !==
            prepared.width ||
          previous.height !==
            prepared.height
        )
      ) {
        throw new Error(
          'Dimensiones de fuente inconsistentes.',
        );
      }

      let source =
        previous?.source;

      if (source === undefined) {
        source =
          hashes.size;

        stage = 'upload_pdf_source hacia Rust';
        await invoke(
          'upload_pdf_source',
          bytes,
          {
            headers: {
              'x-nestra-session':
                id,
              'x-nestra-source':
                String(source),
            },
          },
        );

        hashes.set(
          hash,
          {
            source,
            width:
              prepared.width,
            height:
              prepared.height,
          },
        );
      }

      sources.set(
        definition.id,
        source,
      );
      if (mark) {
        const labels = markedSourceLabels.get(source) ?? new Set<string>();
        labels.add(sourceLabel);
        markedSourceLabels.set(source, labels);
      }
    }

    const output:
      PdfDiagnostics[] = [];

    for (
      let index = 0;
      index <
      report.layouts.length;
      index += 1
    ) {
      signal.throwIfAborted();

      context = `canvas ${index + 1}/${report.layouts.length}`;
      stage = 'finish_pdf_prototype hacia Rust';

      progress(
        `Exportando ${index + 1} / ${report.layouts.length}…`,
      );

      const layout =
        report.layouts[index];

      if (!layout) {
        continue;
      }

      try {
        output.push(
          await invoke<PdfDiagnostics>(
            'finish_pdf_prototype',
            {
              id,
              plan:
                nativePngPlan(
                  layout,
                  sources,
                  sizeMarkSources,
                ),
            },
          ),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const sourceId = /fuente (\d+)/i.exec(message)?.[1];
        const labels = sourceId === undefined ? undefined : markedSourceLabels.get(Number(sourceId));
        throw new Error(labels?.size
          ? `${message} (${[...labels].join('; ')})`
          : message, { cause: error });
      }
    }

    const outputBytes =
      output.reduce(
        (total, result) =>
          total +
          result.outputBytes,
        0,
      );

    const backendMs =
      output.reduce(
        (total, result) =>
          total +
          result.totalMs,
        0,
      );

    console.info(
      [
        'PDF export',
        `Archivos: ${output.length}`,
        `Fuentes únicas: ${hashes.size}`,
        `Tamaño: ${(outputBytes / 1048576).toFixed(2)} MiB`,
        `Backend: ${(backendMs / 1000).toFixed(2)} s`,
        `Total: ${((performance.now() - started) / 1000).toFixed(2)} s`,
      ].join('\n'),
    );

    return output.map(
      (result) =>
        result.path,
    );
  } catch (error) {
    failed = true;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Falló la exportación PDF en etapa «${stage}»${context ? ` · ${context}` : ''}: ${message}`,
      { cause: error },
    );
  } finally {
    if (id) {
      try {
        await invoke(
          'close_pdf_prototype',
          {
            id,
          },
        );
      } catch (error) {
        if (failed) {
          console.error('También falló el cierre de la sesión PDF.', error);
        } else {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Falló la exportación PDF en etapa «cerrar la sesión Rust» · sessionId=${id}: ${message}`, { cause: error });
        }
      }
    }
  }
}
