import { afterEach, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { recordOptimizedBatch, loadHistoricalJobs } from './historical-jobs';
import { HistoricalJobs } from '../app/historical-jobs';

afterEach(() => localStorage.clear());

it('stores grouped extras only for new jobs, independently of the required PNG summary', () => {
  recordOptimizedBatch({
    canvasCount: 1,
    fabrics: [{ fabric: 'deportiva', meters: 0.1 }],
    freePngPieces: [{ name: 'logo.png', fabric: 'deportiva', count: 4 }],
    extraPieces: [
      { name: 'logo.png', fabric: 'deportiva', count: 4 },
      { name: 'logo.png', fabric: 'deportiva', count: 3 },
      { name: 'zero.png', fabric: 'polar', count: 0 },
    ],
  });
  const job = loadHistoricalJobs()[0]!;
  expect(job.freePngPieces).toEqual([
    { name: 'logo.png', fabric: 'deportiva', count: 4 },
  ]);
  expect(job.extraPieces).toEqual([
    { name: 'logo.png', fabric: 'deportiva', count: 7 },
  ]);
  render(<HistoricalJobs />);
  const designs = screen.getByText('DISEÑOS').closest('details')!;
  expect(within(designs).getAllByText('logo.png')).toHaveLength(2);
  expect(designs.textContent).toMatch(/logo.png.*×4.*EXTRA.*logo.png.*\+7/);
  expect(screen.queryByText('zero.png')).not.toBeInTheDocument();
});

it('reads legacy records without adding extra fields or rewriting their storage', () => {
  const old = [
    {
      id: 'old',
      jobNumber: 1,
      name: '1 (2026-09-01)',
      sourceFolderPath: '',
      createdAt: 1000,
      canvasCount: 1,
      meters: { deportiva: 0.1, polar: 0, unclassified: 0 },
      files: [],
      importedHistorical: false,
    },
  ];
  const raw = JSON.stringify(old);
  localStorage.setItem('nestra.historical-jobs', raw);
  expect(loadHistoricalJobs()).toEqual(old);
  expect(localStorage.getItem('nestra.historical-jobs')).toBe(raw);
  render(<HistoricalJobs />);
  expect(screen.queryByText('EXTRA')).not.toBeInTheDocument();
});

it('omits the optional EXTRA section for zero extras, including a batch of normal free PNGs', () => {
  recordOptimizedBatch({
    canvasCount: 1,
    fabrics: [{ fabric: 'polar', meters: 0.1 }],
    freePngPieces: [{ name: 'normal.png', fabric: 'polar', count: 3 }],
    extraPieces: [],
  });
  expect(loadHistoricalJobs()[0]).not.toHaveProperty('extraPieces');
  render(<HistoricalJobs />);
  expect(screen.getByText('normal.png')).toBeInTheDocument();
  expect(screen.queryByText('EXTRA')).not.toBeInTheDocument();
});
