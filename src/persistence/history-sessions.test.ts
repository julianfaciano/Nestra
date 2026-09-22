import { beforeEach, expect, it } from 'vitest';
import {
  groupHistoricalJobs,
  loadHistoricalJobs,
  recordOptimizedBatch,
  type HistoricalJob,
} from './historical-jobs';

beforeEach(() => {
  localStorage.clear();
});

function localJob(id: string, createdAt: number, importedHistorical = false): HistoricalJob {
  return {
    id,
    jobNumber: 1,
    name: id,
    sourceFolderPath: importedHistorical ? `C:/old/${id}` : '',
    createdAt,
    canvasCount: 1,
    meters: { deportiva: 1, polar: 0, unclassified: 0 },
    files: [],
    importedHistorical,
  };
}

it('records a productive run only once for the same optimizationRunId', () => {
  const batch = {
    optimizationRunId: 'run-1',
    createdAt: Date.now(),
    canvasCount: 1,
    fabrics: [{ fabric: 'deportiva', meters: 1 }],
  };
  recordOptimizedBatch(batch);
  recordOptimizedBatch(batch);
  expect(loadHistoricalJobs()).toHaveLength(1);
});

it('preserves arbitrary fabric names in the historical breakdown', () => {
  recordOptimizedBatch({
    optimizationRunId: 'set-run',
    createdAt: Date.now(),
    canvasCount: 1,
    fabrics: [{ fabric: 'set', meters: 1.25 }],
  });
  const job = loadHistoricalJobs()[0]!;
  expect(job.fabrics).toEqual([{ fabric: 'set', meters: 1.25 }]);
  expect(job.meters.unclassified).toBe(1.25);
});

it('groups local runs by consecutive gaps of at most ten minutes', () => {
  const start = new Date(2026, 7, 19, 10, 0).getTime();
  const grouped = groupHistoricalJobs([
    localJob('a', start),
    localJob('b', start + 8 * 60 * 1000),
    localJob('c', start + 17 * 60 * 1000),
    localJob('d', start + 28 * 60 * 1000),
  ]);
  expect(grouped).toHaveLength(2);
  const session = grouped.find((job) => job.sessionJobIds)!;
  expect(session.canvasCount).toBe(3);
  expect(session.sessionJobIds).toEqual(['a', 'b', 'c']);
  expect(grouped.find((job) => job.id === 'd')?.sessionJobIds).toBeUndefined();
});

it('does not mix imported jobs or local calendar dates and aggregates designs, sizes, fabrics and extras', () => {
  const first = new Date(2026, 7, 19, 10, 0).getTime();
  const second: HistoricalJob = {
    ...localJob('b', first + 8 * 60 * 1000),
    sizeSummary: [{ model: 'Perrito', fabric: 'deportiva', sizes: [{ size: 'T8', quantity: 2 }] }],
    freePngPieces: [{ name: 'logo.png', fabric: 'deportiva', count: 2 }],
    extraPieces: [{ name: 'logo.png', fabric: 'deportiva', count: 3 }],
  };
  const firstJob: HistoricalJob = {
    ...localJob('a', first),
    sizeSummary: [{ model: 'Perrito', fabric: 'deportiva', sizes: [{ size: 'T8', quantity: 1 }] }],
    freePngPieces: [{ name: 'logo.png', fabric: 'deportiva', count: 1 }],
    extraPieces: [{ name: 'logo.png', fabric: 'deportiva', count: 2 }],
  };
  const nextDay = localJob('next', new Date(2026, 7, 20, 10, 0).getTime());
  const imported = localJob('imported', first + 20 * 60 * 1000, true);
  const grouped = groupHistoricalJobs([firstJob, second, nextDay, imported]);
  const session = grouped.find((job) => job.sessionJobIds);
  expect(session?.sizeSummary?.[0]?.sizes[0]?.quantity).toBe(3);
  expect(session?.freePngPieces?.[0]?.count).toBe(3);
  expect(session?.extraPieces?.[0]?.count).toBe(5);
  expect(grouped.filter((job) => job.importedHistorical)).toHaveLength(1);
  expect(grouped).toHaveLength(3);
});

it.each([
  [[0, 8, 17], 1],
  [[0, 8, 19], 2],
  [[0, 10], 1],
  [[0, 10 + 1 / 60000], 2],
  [[0, 9, 18, 27], 1],
] as const)('groups minute offsets %j into %i sessions', (minutes, count) => {
  const start = new Date(2026, 7, 19, 10).getTime();
  expect(groupHistoricalJobs(minutes.map((minute, i) => localJob(String(i), start + Math.round(minute * 60000))))).toHaveLength(count);
});

it('does not group across midnight even with a one-minute gap', () => {
  expect(groupHistoricalJobs([
    localJob('a', new Date(2026, 7, 19, 23, 59).getTime()),
    localJob('b', new Date(2026, 7, 20, 0, 0).getTime()),
  ])).toHaveLength(2);
});
