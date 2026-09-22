import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { Blob as NodeBlob } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { invoke } from '@tauri-apps/api/core';

import {
  preflightBatch,
  PX_PER_MM,
  type ExportLayout,
  type PreparedBatch,
} from './export-plan';

import {
  exportBatchPng,
  nativePngPlan,
  type NativeRenderDiagnostics,
  type PngExportDiagnostics,
} from './native-png-export';

import { mm } from '../domain/units';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: () => true,
  Channel: class {
    onmessage?: (percent: number) => void;
  },
}));

vi.mock('./export-plan', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('./export-plan')
  >()),
  preflightBatch: vi.fn(),
}));

const definition = {
  kind: 'garment' as const,
  id: 'front',
  model: 'shirt',
  size: 'T8' as const,
  side: 'front' as const,
  fabric: 'deportiva',
  quantity: 1,

  fileName: 'front.png',
  imageUrl: 'blob:front',

  sourceWidthPx: 7,
  sourceHeightPx: 5,

  physicalWidthMm: mm(7 * 25.4 / 72),
  physicalHeightMm: mm(5 * 25.4 / 72),

  alphaThreshold: 16,
  simplificationTolerancePx: 1.5,
};

const layout: ExportLayout = {
  name: 'deportiva_2_copias.png',
  fabric: 'deportiva',

  widthMm: 20,
  heightMm: 100,

  widthPx: 236,
  heightPx: 1181,

  offsetX: -2,
  offsetY: 3,

  pieces: [
    {
      definition,
      translateX: 23,
      translateY: -2,
      placement: {
        x: 0,
        y: 0,
        rotation: 90,
      },
    },
    {
      definition,
      translateX: 30,
      translateY: 30,
      placement: {
        x: 0,
        y: 0,
        rotation: -90,
      },
    },
  ],
};

const batch = {} as PreparedBatch;

const renderDiagnostics: NativeRenderDiagnostics = {
  name: 'deportiva_2_copias.png',
  width: 236,
  height: 1181,
  outputBytes: 1234,

  compositionMs: 2,
  rgbConvertMs: 1,
  encodeWriteMs: 3,
  totalMs: 5,

  strips: 19,
  pieceDraws: 2,

  decodedSources: 1,
  decodedBytes: 140,
  rasterWorkingBytes: 1000,
};

beforeEach(() => {
  vi.mocked(preflightBatch).mockReturnValue({
    errors: [],
    warnings: [],
    layouts: [layout],
    boundsIssues: [],
  });

  vi.stubGlobal('crypto', webcrypto);

  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      blob: () =>
        Promise.resolve(
          new NodeBlob([
            new Uint8Array([1, 2, 3]),
          ]),
        ),
    }),
  );

  vi.mocked(invoke).mockReset();

  vi.mocked(invoke).mockImplementation(
    async (command) => {
      if (command === 'choose_export_folder') {
        return true;
      }

      if (command === 'begin_native_export') {
        return 'job';
      }

      if (command === 'upload_png_source') {
        return { decodeMs: 1 };
      }

      if (
        command ===
        'resolve_export_destination'
      ) {
        return 'C:/output/deportiva_2_copias.png';
      }

      if (command === 'render_native_png') {
        return {
          path: 'C:/output/deportiva_2_copias.png',
          diagnostics: renderDiagnostics,
        };
      }

      return undefined;
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe(
  'native PNG export orchestration',
  () => {
    it(
      'sends one compressed source and one plan, independent of strip count',
      async () => {
        let diagnostics:
          | PngExportDiagnostics
          | undefined;

        const paths = await exportBatchPng(
          batch,
          new AbortController().signal,
          vi.fn(),
          (value) => {
            diagnostics = value;
          },
        );

        expect(paths).toEqual([
          'C:/output/deportiva_2_copias.png',
        ]);

        expect(
          vi
            .mocked(invoke)
            .mock.calls.map(
              (call) => call[0],
            ),
        ).toEqual([
          'choose_export_folder',
          'begin_native_export',
          'upload_png_source',
          'resolve_export_destination',
          'render_native_png',
          'close_native_export',
        ]);

        expect(
          Object.prototype.toString.call(
            vi.mocked(invoke).mock.calls[2]![1],
          ),
        ).toBe('[object ArrayBuffer]');

        expect(
          vi.mocked(invoke).mock.calls[4]![1],
        ).toMatchObject({
          id: 'job',

          plan: {
            name: layout.name,
            width: 236,
            height: 1181,

            pieces: [
              { source: 0 },
              { source: 0 },
            ],
          },

          destination:
            'C:/output/deportiva_2_copias.png',
        });

        expect(diagnostics).toMatchObject({
          ipcCalls: 6,
          sourceUploads: 1,
          sourceBytes: 3,
          decodeMs: 1,
          layouts: [renderDiagnostics],
        });
      },
    );

    it(
      'preserves physical 72 to 300 PPI scale, full margins, offset and rotations',
      () => {
        const plan = nativePngPlan(
          layout,
          new Map([['front', 0]]),
        );

        expect(plan).toMatchObject({
          offsetX: -2 * PX_PER_MM,
          offsetY: 3 * PX_PER_MM,

          pieces: [
            {
              source: 0,
              translateX: 23 * PX_PER_MM,
              translateY: -2 * PX_PER_MM,
              rotation: 90,
            },
            {
              source: 0,
              rotation: -90,
            },
          ],
        });

        expect(
          plan.pieces[0]!.width,
        ).toBeCloseTo(
          7 * 300 / 72,
          12,
        );

        expect(
          plan.pieces[0]!.height,
        ).toBeCloseTo(
          5 * 300 / 72,
          12,
        );

        expect(() =>
          nativePngPlan(layout, new Map()),
        ).toThrow('Fuente no preparada');
      },
    );

    it(
      'reuses identical file contents across different object URLs and canvases',
      async () => {
        const other = {
          ...layout,

          name: 'deportiva_1_copia_b.png',

          pieces: [
            {
              ...layout.pieces[0]!,

              definition: {
                ...definition,
                id: 'back',
                imageUrl: 'blob:back',
              },
            },
          ],
        };

        vi.mocked(
          preflightBatch,
        ).mockReturnValue({
          errors: [],
          warnings: [],
          layouts: [layout, other],
          boundsIssues: [],
        });

        await exportBatchPng(
          batch,
          new AbortController().signal,
          vi.fn(),
        );

        expect(
          vi
            .mocked(invoke)
            .mock.calls.filter(
              (call) =>
                call[0] ===
                'upload_png_source',
            ),
        ).toHaveLength(1);

        expect(
          vi
            .mocked(invoke)
            .mock.calls.filter(
              (call) =>
                call[0] ===
                'render_native_png',
            ),
        ).toHaveLength(2);

        expect(fetch).toHaveBeenCalledTimes(2);
      },
    );

    it(
      'selects one folder and resolves one automatic destination per layout',
      async () => {
        const second = {
          ...layout,
          name: 'deportiva_1_copia_b.png',
        };

        vi.mocked(
          preflightBatch,
        ).mockReturnValue({
          errors: [],
          warnings: [],
          layouts: [layout, second],
          boundsIssues: [],
        });

        vi.mocked(invoke).mockImplementation(
          async (command, args) => {
            if (
              command ===
              'choose_export_folder'
            ) {
              return true;
            }

            if (
              command ===
              'begin_native_export'
            ) {
              return 'job';
            }

            if (
              command ===
              'upload_png_source'
            ) {
              return { decodeMs: 1 };
            }

            if (
              command ===
              'resolve_export_destination'
            ) {
              const request = args as {
                suggestedName?: string;
              };

              return `C:/output/${request.suggestedName}`;
            }

            if (
              command ===
              'render_native_png'
            ) {
              const request = args as {
                destination?: string;
              };

              return {
                path: request.destination,
                diagnostics:
                  renderDiagnostics,
              };
            }

            return undefined;
          },
        );

        const paths = await exportBatchPng(
          batch,
          new AbortController().signal,
          vi.fn(),
        );

        expect(paths).toEqual([
          'C:/output/deportiva_2_copias.png',
          'C:/output/deportiva_1_copia_b.png',
        ]);

        expect(
          vi
            .mocked(invoke)
            .mock.calls.filter(
              (call) =>
                call[0] ===
                'choose_export_folder',
            ),
        ).toHaveLength(1);

        expect(
          vi
            .mocked(invoke)
            .mock.calls.filter(
              (call) =>
                call[0] ===
                'begin_native_export',
            ),
        ).toHaveLength(1);

        expect(
          vi
            .mocked(invoke)
            .mock.calls.filter(
              (call) =>
                call[0] ===
                'resolve_export_destination',
            ),
        ).toHaveLength(2);
      },
    );

    it(
      're-resolves an automatic destination if publication races with an existing file',
      async () => {
        let attempts = 0;

        vi.mocked(invoke).mockImplementation(
          async (command) => {
            if (
              command ===
              'choose_export_folder'
            ) {
              return true;
            }

            if (
              command ===
              'begin_native_export'
            ) {
              return 'job';
            }

            if (
              command ===
              'upload_png_source'
            ) {
              return { decodeMs: 1 };
            }

            if (
              command ===
              'resolve_export_destination'
            ) {
              attempts += 1;

              return attempts === 1
                ? 'C:/output/existing.png'
                : 'C:/output/new.png';
            }

            if (
              command ===
                'render_native_png' &&
              attempts === 1
            ) {
              throw new Error(
                'Ya existe ese archivo. Elegí otro nombre o ubicación.',
              );
            }

            if (
              command ===
              'render_native_png'
            ) {
              return {
                path: 'C:/output/new.png',
                diagnostics:
                  renderDiagnostics,
              };
            }

            return undefined;
          },
        );

        await expect(
          exportBatchPng(
            batch,
            new AbortController().signal,
            vi.fn(),
          ),
        ).resolves.toEqual([
          'C:/output/new.png',
        ]);

        expect(attempts).toBe(2);

        expect(
          vi
            .mocked(invoke)
            .mock.calls.filter(
              (call) =>
                call[0] ===
                'begin_native_export',
            ),
        ).toHaveLength(1);
      },
    );

    it(
      'cancels cleanly when the folder dialog is cancelled',
      async () => {
        vi.mocked(invoke).mockImplementation(
          async (command) => {
            if (
              command ===
              'choose_export_folder'
            ) {
              return false;
            }

            return undefined;
          },
        );

        expect(
          await exportBatchPng(
            batch,
            new AbortController().signal,
            vi.fn(),
          ),
        ).toEqual([]);

        expect(fetch).not.toHaveBeenCalled();

        expect(invoke).toHaveBeenCalledTimes(1);

        expect(invoke).toHaveBeenCalledWith(
          'choose_export_folder',
        );
      },
    );

    it(
      'cleans up after source failure',
      async () => {
        vi.stubGlobal(
          'fetch',
          vi
            .fn()
            .mockRejectedValue(
              new Error(
                'source unavailable',
              ),
            ),
        );

        await expect(
          exportBatchPng(
            batch,
            new AbortController().signal,
            vi.fn(),
          ),
        ).rejects.toThrow(
          'source unavailable',
        );

        expect(
          invoke,
        ).toHaveBeenLastCalledWith(
          'close_native_export',
          {
            id: 'job',
          },
        );
      },
    );

    it(
      'cancels a running native render with a single close and waits for cleanup',
      async () => {
        const controller =
          new AbortController();

        let rejectRender:
          | ((reason: Error) => void)
          | undefined;

        vi.mocked(invoke).mockImplementation(
          (command) => {
            if (
              command ===
              'choose_export_folder'
            ) {
              return Promise.resolve(true);
            }

            if (
              command ===
              'begin_native_export'
            ) {
              return Promise.resolve('job');
            }

            if (
              command ===
              'upload_png_source'
            ) {
              return Promise.resolve({
                decodeMs: 0,
              });
            }

            if (
              command ===
              'resolve_export_destination'
            ) {
              return Promise.resolve(
                'C:/output/deportiva_2_copias.png',
              );
            }

            if (
              command ===
              'render_native_png'
            ) {
              return new Promise(
                (_, reject) => {
                  rejectRender = reject;

                  queueMicrotask(() => {
                    controller.abort();
                  });
                },
              );
            }

            if (
              command ===
              'close_native_export'
            ) {
              rejectRender?.(
                new Error(
                  'Exportación cancelada.',
                ),
              );

              return Promise.resolve();
            }

            throw new Error(
              'Unexpected invoke',
            );
          },
        );

        await expect(
          exportBatchPng(
            batch,
            controller.signal,
            vi.fn(),
          ),
        ).rejects.toThrow('cancelada');

        expect(
          vi
            .mocked(invoke)
            .mock.calls.filter(
              (call) =>
                call[0] ===
                'close_native_export',
            ),
        ).toHaveLength(1);
      },
    );

    it(
      'records published paths if cancellation races the successful render response',
      async () => {
        const controller =
          new AbortController();

        const previous = vi
          .mocked(invoke)
          .getMockImplementation()!;

        vi.mocked(invoke).mockImplementation(
          (command, args, options) => {
            if (
              command ===
              'render_native_png'
            ) {
              controller.abort();
            }

            return previous(
              command,
              args,
              options,
            );
          },
        );

        await expect(
          exportBatchPng(
            batch,
            controller.signal,
            vi.fn(),
          ),
        ).rejects.toThrow(
          'Ya guardados: C:/output/deportiva_2_copias.png',
        );
      },
    );

    it(
      'pre-aborted jobs do not invoke or fetch',
      async () => {
        const controller =
          new AbortController();

        controller.abort();

        await expect(
          exportBatchPng(
            batch,
            controller.signal,
            vi.fn(),
          ),
        ).rejects.toThrow();

        expect(invoke).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
      },
    );

    it(
      'cleans up if cancellation occurs while begin is resolving',
      async () => {
        const controller =
          new AbortController();

        vi.mocked(invoke).mockImplementation(
          async (command) => {
            if (
              command ===
              'choose_export_folder'
            ) {
              return true;
            }

            if (
              command ===
              'begin_native_export'
            ) {
              controller.abort();

              return 'job';
            }

            return undefined;
          },
        );

        await expect(
          exportBatchPng(
            batch,
            controller.signal,
            vi.fn(),
          ),
        ).rejects.toThrow();

        expect(
          invoke,
        ).toHaveBeenLastCalledWith(
          'close_native_export',
          {
            id: 'job',
          },
        );

        expect(fetch).not.toHaveBeenCalled();
      },
    );
  },
);
