import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BatchPage } from './batch-page';
import { chooseFreePng } from './free-png-import';
import { nestInWorker } from '../geometry/nesting-client';
import {
  nestMultiplePieces,
  type MultiNestingInput,
} from '../geometry/multi-piece-nesting-engine';
import { exportPdfPrototype } from '../export/pdf-prototype';
import { recordOptimizedBatch } from '../persistence/historical-jobs';

vi.mock('./free-png-import', async (original) => ({
  ...(await original<typeof import('./free-png-import')>()),
  chooseFreePng: vi.fn(),
}));
vi.mock('../geometry/nesting-client', () => ({
  nestInWorker: vi.fn(async (input: MultiNestingInput) =>
    nestMultiplePieces(input),
  ),
}));
vi.mock('../export/pdf-prototype', () => ({
  exportPdfPrototype: vi.fn(async () => ['output.pdf']),
}));
vi.mock('../persistence/contour-cache', () => ({
  buildContourCacheKey: vi.fn(async () => 'test'),
  loadCachedContourPair: vi.fn(),
  saveCachedContourPair: vi.fn(),
}));
vi.mock('../persistence/historical-jobs', () => ({
  recordOptimizedBatch: vi.fn(),
}));
vi.mock('./historical-preview-builder', () => ({
  buildHistoricalBatchPreviewFiles: vi.fn(async () => []),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('imports, nests and exports a free-only batch; edits invalidate it and removal releases its URL', async () => {
  const revoke = vi.fn();
  vi.stubGlobal(
    'URL',
    Object.assign(class extends URL {}, { revokeObjectURL: revoke }),
  );
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 72, height: 72, close: vi.fn() })),
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
    getImageData: () => ({
      width: 72,
      height: 72,
      data: new Uint8ClampedArray(72 * 72 * 4).fill(255),
    }),
  } as unknown as CanvasRenderingContext2D);
  vi.mocked(chooseFreePng).mockImplementationOnce(async (quantity) => ({
    kind: 'free-png',
    id: 'free',
    file: new File(['png'], 'logo.png', { type: 'image/png' }),
    imageUrl: 'blob:free',
    sourceWidthPx: 72,
    sourceHeightPx: 72,
    quantity,
    fabric: 'deportiva',
  }));
  const view = render(<BatchPage templates={[]} collections={[]} />);
  fireEvent.change(screen.getByLabelText('Cantidad inicial de PNG libre'), {
    target: { value: '3' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'COLOCAR PNG' }));
  await screen.findByText('logo.png');
  expect(screen.getByLabelText('Cantidad inicial de PNG libre')).toHaveValue(1);
  expect(screen.getByLabelText('Cantidad de logo.png')).toHaveValue(3);
  expect(screen.getByText('2,54 × 2,54 cm')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Cantidad de logo.png'), {
    target: { value: '0' },
  });
  expect(screen.getByLabelText('Cantidad de logo.png')).toHaveValue(3);

  fireEvent.click(screen.getByRole('button', { name: 'OPTIMIZAR BATCH' }));
  const exportButton = await screen.findByRole('button', {
    name: 'EXPORTAR 1 ARCHIVO',
  });
  expect(recordOptimizedBatch).not.toHaveBeenCalled();
  expect(vi.mocked(nestInWorker).mock.calls[0]![0].pieces).toHaveLength(3);
  expect(
    vi.mocked(nestInWorker).mock.calls[0]![0].pieces[0]!.allowedRotations,
  ).toEqual([0, 90, -90, 180]);
  fireEvent.click(exportButton);
  await screen.findByRole('button', { name: '1 ARCHIVO EXPORTADO' });
  await waitFor(() => expect(recordOptimizedBatch).toHaveBeenCalledWith(
    expect.objectContaining({ sizeSummary: [], canvasCount: 1 }),
  ));
  const exported = vi.mocked(exportPdfPrototype).mock.calls[0]![0];
  expect(exported.definitions).toHaveLength(1);
  expect(exported.definitions[0]).toMatchObject({
    kind: 'free-png',
    quantity: 3,
  });
  expect(exported.definitions[0]).not.toHaveProperty('side');

  vi.mocked(chooseFreePng).mockResolvedValueOnce(null);
  fireEvent.click(screen.getByRole('button', { name: 'COLOCAR PNG' }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'COLOCAR PNG' }),
    ).not.toBeDisabled(),
  );
  expect(
    screen.getByRole('button', { name: '1 ARCHIVO EXPORTADO' }),
  ).toBeInTheDocument();

  const fill = screen.getByRole('button', { name: 'RELLENAR SOBRANTES' });
  expect(fill).toHaveAttribute('title', 'RELLENAR SOBRANTES');
  expect(fill).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(fill);
  expect(fill).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByText('LISTO PARA EXPORTAR')).not.toBeInTheDocument();
  expect(screen.queryByText(/^\+\d+$/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'OPTIMIZAR BATCH' }));
  await screen.findByRole('button', { name: 'EXPORTAR 1 ARCHIVO' });
  await waitFor(() => expect(fill).not.toBeDisabled());
  const filled = await vi.mocked(nestInWorker).mock.results.at(-1)!.value;
  const count = filled.layouts
    .flatMap((l: { pieces: { extra?: unknown }[] }) => l.pieces)
    .filter((p: { extra?: unknown }) => p.extra).length;
  expect(count).toBeGreaterThan(0);
  expect(screen.getByText(`+${count}`)).toBeInTheDocument();
  expect(screen.getByLabelText('Cantidad de logo.png')).toHaveValue(3);
  expect(
    vi.mocked(nestInWorker).mock.calls.at(-1)![0].fillers![0]!.priority,
  ).toBe(1);
  expect(recordOptimizedBatch).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'EXPORTAR 1 ARCHIVO' }));
  await screen.findByRole('button', { name: '1 ARCHIVO EXPORTADO' });
  await waitFor(() => expect(recordOptimizedBatch).toHaveBeenCalledTimes(2));
  expect(recordOptimizedBatch).toHaveBeenLastCalledWith(
    expect.objectContaining({
      freePngPieces: [{ name: 'logo.png', fabric: 'deportiva', count: 3 }],
      extraPieces: [{ name: 'logo.png', fabric: 'deportiva', count }],
    }),
  );
  expect(
    vi
      .mocked(exportPdfPrototype)
      .mock.calls.at(-1)![0]
      .results.flatMap((r) => r.layouts.flatMap((l) => l.pieces))
      .filter((p) => p.extra),
  ).toHaveLength(count);
  fireEvent.click(fill);
  expect(screen.queryByText(`+${count}`)).not.toBeInTheDocument();
  expect(fill).toHaveAttribute('aria-label', 'RELLENAR SOBRANTES · MÁXIMA IMPORTANCIA');
  expect(fill).toHaveAttribute('data-fill-mode', 'max');
  expect(fill.querySelector('.fill-gaps-max-mark')).not.toBeNull();
  fireEvent.click(fill);
  expect(fill).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(fill);
  fireEvent.click(screen.getByRole('button', { name: 'OPTIMIZAR BATCH' }));
  await screen.findByRole('button', { name: 'EXPORTAR 1 ARCHIVO' });
  await waitFor(() => expect(fill).not.toBeDisabled());
  expect(
    vi.mocked(nestInWorker).mock.calls.at(-1)![0].fillers![0]!.priority,
  ).toBe(2);

  fireEvent.change(screen.getByLabelText('Cantidad de logo.png'), {
    target: { value: '2' },
  });
  expect(screen.queryByText('LISTO PARA EXPORTAR')).not.toBeInTheDocument();
  expect(screen.queryByText(/^\+\d+$/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'OPTIMIZAR BATCH' }));
  await screen.findByRole('button', { name: 'EXPORTAR 1 ARCHIVO' });
  fireEvent.change(screen.getByLabelText('Tela de logo.png'), {
    target: { value: 'polar' },
  });
  expect(screen.queryByText('LISTO PARA EXPORTAR')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'OPTIMIZAR BATCH' }));
  await screen.findByRole('button', { name: 'EXPORTAR 1 ARCHIVO' });
  fireEvent.click(screen.getByRole('button', { name: 'Eliminar logo.png' }));
  expect(screen.queryByText('LISTO PARA EXPORTAR')).not.toBeInTheDocument();
  expect(screen.queryByText('logo.png')).not.toBeInTheDocument();
  expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:free');
  view.unmount();
  expect(revoke).toHaveBeenCalledOnce();
});
