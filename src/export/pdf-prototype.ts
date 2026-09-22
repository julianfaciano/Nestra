import {
  invoke,
  isTauri,
} from '@tauri-apps/api/core';

import {
  preflightBatch,
  type PreparedBatch,
} from './export-plan';

import { nativePngPlan } from './native-png-export';
import { prepareExportSourceBlob } from './export-source-crop';

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
): Promise<string[]> {
  if (!isTauri()) {
    throw new Error(
      'El PDF requiere Nestra Windows.',
    );
  }

  const report =
    preflightBatch(batch);

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

  const id =
    await invoke<string | null>(
      'begin_pdf_prototype',
      {
        name: 'pdf',
      },
    );

  if (!id) {
    return [];
  }

  const started =
    performance.now();

  try {
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

      progress(
        `Preparando fuentes PDF (${hashes.size})…`,
      );

      const response =
        await fetch(
          definition.imageUrl,
        );

      if (!response.ok) {
        throw new Error(
          `No se pudo leer ${definition.fileName}.`,
        );
      }

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

      const prepared =
        await prepareExportSourceBlob(
          original,
          definition,
          artwork.sourceCrop,
          signal,
        );

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

      progress(
        `Exportando ${index + 1} / ${report.layouts.length}…`,
      );

      const layout =
        report.layouts[index];

      if (!layout) {
        continue;
      }

      output.push(
        await invoke<PdfDiagnostics>(
          'finish_pdf_prototype',
          {
            id,
            plan:
              nativePngPlan(
                layout,
                sources,
              ),
          },
        ),
      );
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
  } finally {
    await invoke(
      'close_pdf_prototype',
      {
        id,
      },
    );
  }
}
