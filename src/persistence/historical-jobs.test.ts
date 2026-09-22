import {
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

import {
  buildImportableHistoricalJobs,
  buildImportedHistoricalJob,
  formatHistoricalDate,
  historicalCopiesFromName,
  historicalFabricFromName,
  historicalMetricsFromFiles,
  historicalTimestampFromText,
  loadHistoricalJobs,
  mergeHistoricalJobs,
  recordOptimizedBatch,
  saveHistoricalJobs,
  sortHistoricalJobs,
  type HistoricalFile,
  type HistoricalJob,
} from './historical-jobs';

const STORAGE_KEY =
  'nestra.historical-jobs';

function historicalFile(
  name: string,
  physicalHeightCm: number,
): HistoricalFile {
  return {
    name,
    path: `C:\\historial\\${name}`,
    size: 1_000,
    type: 'jpg',
    widthPx: 17_000,
    heightPx: 11_000,
    physicalWidthCm: 144,
    physicalHeightCm,
  };
}

function job(
  patch: Partial<HistoricalJob> & {
    readonly id: string;
    readonly createdAt: number;
  },
): HistoricalJob {
  return {
    id: patch.id,
    jobNumber:
      patch.jobNumber ?? 0,
    name:
      patch.name ??
      'Trabajo',
    sourceFolderPath:
      patch.sourceFolderPath ?? '',
    createdAt:
      patch.createdAt,
    canvasCount:
      patch.canvasCount ?? 1,
    meters:
      patch.meters ?? {
        deportiva: 0,
        polar: 0,
        unclassified: 0,
      },
    files:
      patch.files ?? [],
    importedHistorical:
      patch.importedHistorical ??
      false,
    ...(patch.sizeSummary
      ? {
          sizeSummary:
            patch.sizeSummary,
        }
      : {}),
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe(
  'historical filename parsing',
  () => {
    it(
      'lee copia singular y plural',
      () => {
        expect(
          historicalCopiesFromName(
            '1 copia.jpg',
          ),
        ).toBe(1);

        expect(
          historicalCopiesFromName(
            '17 copias (ARG 1 al 6).jpg',
          ),
        ).toBe(17);

        expect(
          historicalCopiesFromName(
            'archivo sin cantidad.jpg',
          ),
        ).toBe(1);
      },
    );

    it(
      'clasifica solamente telas explícitas',
      () => {
        expect(
          historicalFabricFromName(
            'TELA DEPORTIVA 2 copias.jpg',
          ),
        ).toBe('deportiva');

        expect(
          historicalFabricFromName(
            'tela deportiva 1 copia.jpg',
          ),
        ).toBe('deportiva');

        expect(
          historicalFabricFromName(
            'TELA POLAR 5 copias.jpg',
          ),
        ).toBe('polar');

        expect(
          historicalFabricFromName(
            '1 copia.jpg',
          ),
        ).toBeUndefined();
      },
    );
  },
);

describe(
  'historical physical metrics',
  () => {
    it(
      'multiplica el alto físico por la cantidad de copias',
      () => {
        const metrics =
          historicalMetricsFromFiles([
            historicalFile(
              'TELA DEPORTIVA 3 copias.jpg',
              100,
            ),
          ]);

        expect(
          metrics.canvasCount,
        ).toBe(3);

        expect(
          metrics.meters.deportiva,
        ).toBeCloseTo(3);

        expect(
          metrics.meters.polar,
        ).toBe(0);

        expect(
          metrics.meters.unclassified,
        ).toBe(0);
      },
    );

    it(
      'suma deportiva, polar y sin clasificar por separado',
      () => {
        const metrics =
          historicalMetricsFromFiles([
            historicalFile(
              'TELA DEPORTIVA 2 copias.jpg',
              110,
            ),
            historicalFile(
              'TELA POLAR 3 copias.jpg',
              90,
            ),
            historicalFile(
              '1 copia.jpg',
              80,
            ),
          ]);

        expect(
          metrics.canvasCount,
        ).toBe(6);

        expect(
          metrics.meters.deportiva,
        ).toBeCloseTo(2.2);

        expect(
          metrics.meters.polar,
        ).toBeCloseTo(2.7);

        expect(
          metrics.meters.unclassified,
        ).toBeCloseTo(0.8);
      },
    );

    it(
      'conserva el canvas aunque falte medida física',
      () => {
        const file: HistoricalFile = {
          name: 'TELA POLAR 4 copias.jpg',
          path: 'x',
          size: 1,
          type: 'jpg',
        };

        const metrics =
          historicalMetricsFromFiles([
            file,
          ]);

        expect(
          metrics.canvasCount,
        ).toBe(4);

        expect(
          metrics.meters,
        ).toEqual({
          deportiva: 0,
          polar: 0,
          unclassified: 0,
        });
      },
    );
  },
);

describe(
  'historical dates',
  () => {
    it(
      'acepta meses españoles e ingleses equivalentes',
      () => {
        expect(
          historicalTimestampFromText(
            '97 (19-Ago-26)',
          ),
        ).toBe(
          historicalTimestampFromText(
            '97 (19-Aug-26)',
          ),
        );

        expect(
          historicalTimestampFromText(
            '1 (15-Ene-25)',
          ),
        ).toBe(
          historicalTimestampFromText(
            '1 (15-Jan-25)',
          ),
        );

        expect(
          historicalTimestampFromText(
            '20 (04-Abr-25)',
          ),
        ).toBe(
          historicalTimestampFromText(
            '20 (04-Apr-25)',
          ),
        );

        expect(
          historicalTimestampFromText(
            '40 (10-Dic-25)',
          ),
        ).toBe(
          historicalTimestampFromText(
            '40 (10-Dec-25)',
          ),
        );
      },
    );

    it(
      'muestra la fecha corta sin hora',
      () => {
        const timestamp =
          historicalTimestampFromText(
            '97 (19-Aug-26)',
          );

        expect(timestamp).toBeDefined();

        expect(
          formatHistoricalDate(
            timestamp ?? 0,
          ),
        ).toBe('19/Ago/26');
      },
    );

    it.each(['06-Sep-26', '12-Sep-26', '06-sep-26', '06-SEP-26'])(
      'reconoce carpetas DD-MMM-YY: %s',
      (value) => {
        const timestamp = historicalTimestampFromText(value);
        expect(timestamp).toBeDefined();
        expect(formatHistoricalDate(timestamp ?? 0)).toMatch(/\/Sep\/26$/);
      },
    );

    it.each(['31-Feb-26', '99-Sep-26', 'Mis pedidos'])(
      'rechaza fechas o carpetas inválidas: %s',
      (value) => expect(historicalTimestampFromText(value)).toBeUndefined(),
    );
  },
);

describe(
  'historical ordering and numbering',
  () => {
    it(
      'ordena del más nuevo al más viejo',
      () => {
        const older = job({
          id: 'older',
          jobNumber: 1,
          createdAt:
            Date.UTC(
              2025,
              0,
              1,
              12,
            ),
        });

        const newer = job({
          id: 'newer',
          jobNumber: 2,
          createdAt:
            Date.UTC(
              2026,
              0,
              1,
              12,
            ),
        });

        expect(
          sortHistoricalJobs([
            older,
            newer,
          ]).map(
            (entry) =>
              entry.id,
          ),
        ).toEqual([
          'newer',
          'older',
        ]);
      },
    );

    it(
      'compacta los índices después de eliminar un trabajo',
      () => {
        const one = job({
          id: 'one',
          jobNumber: 1,
          createdAt:
            Date.UTC(
              2025,
              0,
              1,
              12,
            ),
        });

        const two = job({
          id: 'two',
          jobNumber: 2,
          createdAt:
            Date.UTC(
              2025,
              0,
              2,
              12,
            ),
        });

        const three = job({
          id: 'three',
          jobNumber: 3,
          createdAt:
            Date.UTC(
              2025,
              0,
              3,
              12,
            ),
        });

        saveHistoricalJobs([
          one,
          three,
        ]);

        const loaded =
          loadHistoricalJobs();

        expect(
          loaded.map(
            (entry) => ({
              id: entry.id,
              number:
                entry.jobNumber,
            }),
          ),
        ).toEqual([
          {
            id: 'three',
            number: 2,
          },
          {
            id: 'one',
            number: 1,
          },
        ]);

        expect(
          loaded.some(
            (entry) =>
              entry.id === two.id,
          ),
        ).toBe(false);
      },
    );

    it(
      'migra entradas viejas sin jobNumber',
      () => {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify([
            {
              id: 'old-1',
              name:
                '1 (15-Ene-25)',
              sourceFolderPath:
                'C:\\pedidos\\1',
              createdAt:
                Date.UTC(
                  2025,
                  0,
                  15,
                  12,
                ),
              canvasCount: 1,
              meters: {
                deportiva: 0,
                polar: 0,
                unclassified: 1,
              },
              files: [],
              importedHistorical:
                true,
            },
            {
              id: 'old-2',
              name:
                '2 (16-Ene-25)',
              sourceFolderPath:
                'C:\\pedidos\\2',
              createdAt:
                Date.UTC(
                  2025,
                  0,
                  16,
                  12,
                ),
              canvasCount: 1,
              meters: {
                deportiva: 0,
                polar: 0,
                unclassified: 1,
              },
              files: [],
              importedHistorical:
                true,
            },
          ]),
        );

        const loaded =
          loadHistoricalJobs();

        expect(
          loaded.map(
            (entry) =>
              entry.jobNumber,
          ),
        ).toEqual([
          2,
          1,
        ]);
      },
    );

    it(
      'da al próximo batch Nestra el siguiente índice sin huecos',
      () => {
        saveHistoricalJobs([
          job({
            id: 'first',
            jobNumber: 1,
            createdAt:
              Date.UTC(
                2025,
                0,
                1,
                12,
              ),
          }),
          job({
            id: 'third',
            jobNumber: 3,
            createdAt:
              Date.UTC(
                2025,
                0,
                3,
                12,
              ),
          }),
        ]);

        recordOptimizedBatch({
          createdAt:
            Date.UTC(
              2026,
              8,
              6,
              12,
            ),
          canvasCount: 2,
          fabrics: [
            {
              fabric:
                'Tela Deportiva',
              meters: 1.5,
            },
          ],
        });

        const loaded =
          loadHistoricalJobs();

        const newest =
          loaded[0];

        expect(
          newest?.jobNumber,
        ).toBe(3);

        expect(
          newest?.canvasCount,
        ).toBe(2);

        expect(
          newest?.meters.deportiva,
        ).toBeCloseTo(1.5);

        expect(
          newest?.importedHistorical,
        ).toBe(false);
      },
    );
  },
);

describe(
  'historical import migration',
  () => {
    it('acepta DD-MMM-YY en el filtro real de importación y rechaza nombres inválidos', () => {
      const nativeJobs = [
        '06-Sep-26',
        '06-SEP-26',
        '06-sep-26',
        '31-Feb-26',
        'foo',
        '06-XYZ-26',
      ].map((name) => ({
        name,
        path: `C:\\historial\\${name}`,
        files: [historicalFile('TELA DEPORTIVA 1 copia.pdf', 100)],
      }));

      const imported = buildImportableHistoricalJobs(nativeJobs);

      expect(imported.map((job) => job.name)).toEqual([
        '06-Sep-26',
        '06-SEP-26',
        '06-sep-26',
      ]);
      expect(imported.every((job) => job.createdAt > 0)).toBe(true);
      expect(imported.every((job) => job.importedHistorical)).toBe(true);
    });

    it(
      'recalcula métricas importadas desde los archivos aunque haya valores viejos guardados',
      () => {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify([
            {
              id: 'imported',
              jobNumber: 1,
              name:
                '1 (15-Ene-25)',
              sourceFolderPath:
                'C:\\pedidos\\1',
              createdAt:
                Date.UTC(
                  2025,
                  0,
                  15,
                  12,
                ),
              canvasCount: 999,
              meters: {
                deportiva: 999,
                polar: 999,
                unclassified: 999,
              },
              files: [
                {
                  name:
                    'TELA POLAR 2 copias.jpg',
                  path:
                    'C:\\pedidos\\1\\polar.jpg',
                  size: 1000,
                  type: 'jpg',
                  physicalHeightCm:
                    100,
                },
              ],
              importedHistorical:
                true,
            },
          ]),
        );

        const loaded =
          loadHistoricalJobs();

        expect(
          loaded[0]?.canvasCount,
        ).toBe(2);

        expect(
          loaded[0]?.meters,
        ).toEqual({
          deportiva: 0,
          polar: 2,
          unclassified: 0,
        });
      },
    );

    it(
      'preserva batches locales al reimportar históricos',
      () => {
        const local = job({
          id: 'local',
          jobNumber: 98,
          name:
            '98 (06-Sep-26)',
          sourceFolderPath: '',
          createdAt:
            Date.UTC(
              2026,
              8,
              6,
              12,
            ),
          importedHistorical:
            false,
        });

        const previousImported =
          job({
            id: 'historical-id',
            jobNumber: 97,
            name:
              '97 (19-Aug-26)',
            sourceFolderPath:
              'C:\\pedidos\\97',
            createdAt:
              Date.UTC(
                2026,
                7,
                19,
                12,
              ),
            importedHistorical:
              true,
          });

        const incoming =
          buildImportedHistoricalJob({
            name:
              '97 (19-Aug-26)',
            path:
              'C:\\pedidos\\97',
            files: [
              historicalFile(
                'TELA POLAR 2 copias.jpg',
                100,
              ),
            ],
          });

        const merged =
          mergeHistoricalJobs(
            [
              local,
              previousImported,
            ],
            [incoming],
          );

        expect(
          merged.some(
            (entry) =>
              entry.id ===
              local.id,
          ),
        ).toBe(true);

        const refreshed =
          merged.find(
            (entry) =>
              entry
                .sourceFolderPath ===
              'C:\\pedidos\\97',
          );

        expect(
          refreshed?.id,
        ).toBe(
          previousImported.id,
        );

        expect(
          refreshed?.canvasCount,
        ).toBe(2);

        expect(
          refreshed?.meters.polar,
        ).toBeCloseTo(2);
      },
    );
  },
);
