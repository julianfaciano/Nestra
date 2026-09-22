import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BatchPage } from './batch-page';
import { chooseFreePng } from './free-png-import';
import { nestInWorker } from '../geometry/nesting-client';
import {
  nestMultiplePieces,
  type MultiNestingInput,
  type NestingProgress,
} from '../geometry/multi-piece-nesting-engine';
import { exportPdfPrototype } from '../export/pdf-prototype';
import { recordOptimizedBatch } from '../persistence/historical-jobs';

vi.mock('./free-png-import', async (original) => ({
  ...(await original<typeof import('./free-png-import')>()),
  chooseFreePng: vi.fn(),
}));
vi.mock('../geometry/nesting-client', () => ({
  nestInWorker: vi.fn(async (
    input: MultiNestingInput,
    _signal: AbortSignal,
    _reportTiming?: unknown,
    reportProgress?: (progress: NestingProgress) => void,
  ) => nestMultiplePieces(input, reportProgress)),
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

const garmentSizes = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10'] as const;
const garmentSides = ['front', 'back'] as const;

function garmentCollectionFixture() {
  return {
    id: 'fixture',
    name: 'Fixture',
    assets: garmentSizes.flatMap((size) =>
      garmentSides.map((side) => {
        const fileName = `Fixture ${size} ${side}.png`;
        return {
          size,
          side,
          file: new File(['png'], fileName, { type: 'image/png' }),
          fileName,
          relativePath: fileName,
        };
      }),
    ),
    missing: [],
    duplicateSlots: [],
    ignoredFileNames: [],
  };
}

function installGarmentRasterFixture(options?: { readonly strayAlpha?: number }): void {
  const NativeUrl = globalThis.URL;
  let sequence = 0;
  class FixtureUrl extends NativeUrl {}
  Object.assign(FixtureUrl, {
    createObjectURL: vi.fn(() => `blob:fixture-${++sequence}`),
    revokeObjectURL: vi.fn(),
  });
  vi.stubGlobal('URL', FixtureUrl);
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 100, height: 100, close: vi.fn() })),
  );

  const data = new Uint8ClampedArray(100 * 100 * 4);
  for (let y = 10; y < 90; y += 1) {
    for (let x = 10; x < 90; x += 1) {
      const offset = (y * 100 + x) * 4;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = 255;
    }
  }
  if (options?.strayAlpha !== undefined) {
    data[3] = options.strayAlpha;
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
    getImageData: () => ({ width: 100, height: 100, data }),
  } as unknown as CanvasRenderingContext2D);
}

function renderGarmentBatch(quantity: number) {
  installGarmentRasterFixture();
  const view = render(
    <BatchPage templates={[]} collections={[garmentCollectionFixture()]} />,
  );
  fireEvent.change(screen.getByLabelText('Cantidad T1'), {
    target: { value: String(quantity) },
  });
  return view;
}

function currentExportButton() {
  return screen.queryByRole('button', { name: /^Exportar \d+ archivos?$/ });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('muestra prendas, previews y Exportar después de optimizar garments', async () => {
  const view = renderGarmentBatch(2);

  fireEvent.click(screen.getByRole('button', { name: 'Optimizar batch' }));

  await screen.findByRole('region', { name: 'Resultado de optimización' });
  expect(screen.getByText('2/2', { selector: 'strong' })).toBeInTheDocument();
  expect(screen.getByText(/2\/2 prendas colocadas/)).toBeInTheDocument();
  await waitFor(() => expect(currentExportButton()).toBeEnabled());
  expect(view.container.querySelectorAll('.batch-export-layout').length).toBeGreaterThan(0);
});

it('conserva en diagnóstico el perfil real usado por el resultado', async () => {
  renderGarmentBatch(1);
  fireEvent.click(screen.getByRole('button', { name: 'Calandra' }));
  fireEvent.click(screen.getByRole('button', { name: 'Optimizar batch' }));

  await screen.findByRole('region', { name: 'Resultado de optimización' });
  expect(
    screen.getByText((_, element) =>
      element?.tagName === 'PRE' &&
      Boolean(element.textContent?.includes('Perfil ....................... Calandra 1480×5000 mm')),
    ),
  ).toBeInTheDocument();
});

it('cuenta garments y PNG required por separado y exporta sólo con todo colocado', async () => {
  const view = renderGarmentBatch(1);
  vi.mocked(chooseFreePng).mockImplementationOnce(async (quantity) => ({
    kind: 'free-png',
    id: 'required-logo',
    file: new File(['png'], 'logo.png', { type: 'image/png' }),
    imageUrl: 'blob:required-logo',
    sourceWidthPx: 100,
    sourceHeightPx: 100,
    quantity,
    fabric: 'set',
  }));
  fireEvent.click(screen.getByRole('button', { name: 'Agregar PNG' }));
  await screen.findByText('logo.png');

  vi.mocked(nestInWorker).mockImplementationOnce(async (input) => {
    const nested = nestMultiplePieces(input);
    const png = input.pieces.find((piece) => piece.kind === 'free-png');
    if (!png) return nested;
    return {
      ...nested,
      layouts: nested.layouts
        .map((layout) => ({
          ...layout,
          pieces: layout.pieces.filter((piece) => piece.pieceId !== png.id),
        }))
        .filter((layout) => layout.pieces.length > 0),
      unplacedPieceIds: [...nested.unplacedPieceIds, png.id],
      placedCount: Math.max(0, nested.placedCount - 1),
    };
  });

  fireEvent.click(screen.getByRole('button', { name: 'Optimizar batch' }));
  await screen.findByText(/1\/1 prendas colocadas · 0\/1 PNG requeridos colocados/);
  expect(currentExportButton()).not.toBeInTheDocument();
  expect(view.container.querySelectorAll('.batch-export-layout')).toHaveLength(0);

  fireEvent.click(screen.getByRole('button', { name: 'Optimizar batch' }));
  await screen.findByText(/1\/1 prendas colocadas · 1\/1 PNG requeridos colocados/);
  await waitFor(() => expect(currentExportButton()).toBeEnabled());
  expect(view.container.querySelectorAll('.batch-export-layout').length).toBeGreaterThan(0);
});

it('invalida previews y Exportar al cambiar cantidad y los recupera al reoptimizar', async () => {
  const view = renderGarmentBatch(2);

  fireEvent.click(screen.getByRole('button', { name: 'Optimizar batch' }));
  await waitFor(() => expect(currentExportButton()).toBeEnabled());
  expect(view.container.querySelectorAll('.batch-export-layout').length).toBeGreaterThan(0);

  fireEvent.change(screen.getByLabelText('Cantidad T1'), {
    target: { value: '1' },
  });
  expect(screen.queryByRole('region', { name: 'Resultado de optimización' })).not.toBeInTheDocument();
  expect(currentExportButton()).not.toBeInTheDocument();
  expect(view.container.querySelectorAll('.batch-export-layout')).toHaveLength(0);

  fireEvent.click(screen.getByRole('button', { name: 'Optimizar batch' }));
  await screen.findByRole('region', { name: 'Resultado de optimización' });
  expect(screen.getByText('1/1', { selector: 'strong' })).toBeInTheDocument();
  await waitFor(() => expect(currentExportButton()).toBeEnabled());
  expect(view.container.querySelectorAll('.batch-export-layout').length).toBeGreaterThan(0);
});

it('explica el error de preflight después de un nesting terminado y se recupera', async () => {
  const view = renderGarmentBatch(1);
  vi.mocked(nestInWorker).mockImplementationOnce(async (input) => {
    const nested = nestMultiplePieces(input);
    const firstLayout = nested.layouts[0]!;
    const firstPiece = firstLayout.pieces[0]!;
    return {
      ...nested,
      layouts: [{
        ...firstLayout,
        pieces: [
          {
            ...firstPiece,
            placement: { ...firstPiece.placement, x: 1480 },
          },
          ...firstLayout.pieces.slice(1),
        ],
      }],
    };
  });

  fireEvent.click(screen.getByRole('button', { name: 'Optimizar batch' }));
  await screen.findByText(/1\/1 prendas colocadas/);
  const blocked = await screen.findByRole('alert', {
    name: 'Exportación bloqueada',
  });
  expect(blocked).toHaveTextContent('No se puede preparar la exportación');
  expect(blocked).toHaveTextContent('Pieza fuera del canvas');
  expect(currentExportButton()).not.toBeInTheDocument();
  expect(view.container.querySelectorAll('.batch-export-layout')).toHaveLength(0);

  fireEvent.click(screen.getByRole('button', { name: 'Optimizar batch' }));
  await waitFor(() => expect(currentExportButton()).toBeEnabled());
  expect(screen.queryByRole('alert', { name: 'Exportación bloqueada' })).not.toBeInTheDocument();
  expect(view.container.querySelectorAll('.batch-export-layout').length).toBeGreaterThan(0);
});

it('ignora en export el mismo alpha residual que nesting ignora por threshold', async () => {
  installGarmentRasterFixture({ strayAlpha: 1 });
  const view = render(
    <BatchPage templates={[]} collections={[garmentCollectionFixture()]} />,
  );
  fireEvent.change(screen.getByLabelText('Cantidad T1'), {
    target: { value: '1' },
  });

  vi.mocked(nestInWorker).mockImplementationOnce(async (input) => {
    const nested = nestMultiplePieces(input);
    const firstLayout = nested.layouts[0]!;
    const [first, second] = firstLayout.pieces;
    const secondGeometry = input.pieces.find((piece) => piece.id === second!.pieceId)!;
    const xs = (secondGeometry.finePolygon ?? secondGeometry.polygon).map(
      (point) => point.x,
    );
    const visibleWidth = Math.max(...xs) - Math.min(...xs);
    return {
      ...nested,
      layouts: [{
        ...firstLayout,
        pieces: [
          { ...first!, placement: { ...first!.placement, x: 0, y: 0 } },
          {
            ...second!,
            placement: {
              ...second!.placement,
              x: 1480 - visibleWidth,
              y: 0,
            },
          },
        ],
      }],
    };
  });

  fireEvent.click(screen.getByRole('button', { name: 'Optimizar batch' }));

  await screen.findByText(/1\/1 prendas colocadas/);
  await waitFor(() => expect(currentExportButton()).toBeEnabled());
  expect(
    screen.queryByRole('alert', { name: 'Exportación bloqueada' }),
  ).not.toBeInTheDocument();
  expect(view.container.querySelectorAll('.batch-export-layout').length).toBeGreaterThan(0);
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
    fabric: 'set',
  }));
  const onOptimizationChange = vi.fn();
  const view = render(
    <BatchPage
      templates={[]}
      collections={[]}
      onOptimizationChange={onOptimizationChange}
    />,
  );
  expect(screen.getByLabelText('Tipo de tela para todo el batch')).toHaveValue(
    'set',
  );
  expect(screen.getByLabelText('Tipo de tela para todo el batch')).toHaveAttribute(
    'placeholder',
    'set',
  );
  expect(screen.queryByLabelText('Cantidad inicial de PNG libre')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Agregar PNG' }));
  await screen.findByText('logo.png');
  expect(chooseFreePng).toHaveBeenCalledWith(1);
  expect(screen.getByLabelText('Tela de logo.png')).toHaveValue('set');
  expect(screen.getByLabelText('Cantidad de logo.png')).toHaveValue(1);
  fireEvent.change(screen.getByLabelText('Cantidad de logo.png'), {
    target: { value: '3' },
  });
  expect(screen.getByLabelText('Cantidad de logo.png')).toHaveValue(3);
  expect(screen.getByText('2,54 × 2,54 cm')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Cantidad de logo.png'), {
    target: { value: '0' },
  });
  expect(screen.getByLabelText('Cantidad de logo.png')).toHaveValue(3);

  fireEvent.click(screen.getByRole('button', { name: 'Optimizar batch' }));
  const exportButton = await screen.findByRole('button', {
    name: 'Exportar 1 archivo',
  });
  await waitFor(() =>
    expect(onOptimizationChange).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed', progress: 100 }),
    ),
  );
  expect(recordOptimizedBatch).not.toHaveBeenCalled();
  expect(vi.mocked(nestInWorker).mock.calls[0]![0].pieces).toHaveLength(3);
  expect(
    vi.mocked(nestInWorker).mock.calls[0]![0].pieces[0]!.allowedRotations,
  ).toEqual([0, 90, -90, 180]);
  fireEvent.click(exportButton);
  await screen.findByRole('button', { name: '1 archivo exportado' });
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
  fireEvent.click(screen.getByRole('button', { name: 'Agregar PNG' }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Agregar PNG' }),
    ).not.toBeDisabled(),
  );
  expect(
    screen.getByRole('button', { name: '1 archivo exportado' }),
  ).toBeInTheDocument();

  const fill = screen.getByRole('button', { name: 'RELLENAR SOBRANTES' });
  expect(fill).toHaveAttribute('title', 'RELLENAR SOBRANTES');
  expect(fill).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(fill);
  expect(fill).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByText('LISTO PARA EXPORTAR')).not.toBeInTheDocument();
  expect(screen.queryByText(/^\+\d+$/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Optimizar batch' }));
  await screen.findByRole('button', { name: 'Exportar 1 archivo' });
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
  fireEvent.click(screen.getByRole('button', { name: 'Exportar 1 archivo' }));
  await screen.findByRole('button', { name: '1 archivo exportado' });
  await waitFor(() => expect(recordOptimizedBatch).toHaveBeenCalledTimes(2));
  expect(recordOptimizedBatch).toHaveBeenLastCalledWith(
    expect.objectContaining({
      freePngPieces: [{ name: 'logo.png', fabric: 'set', count: 3 }],
      extraPieces: [{ name: 'logo.png', fabric: 'set', count }],
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
  fireEvent.click(screen.getByRole('button', { name: 'Optimizar batch' }));
  await screen.findByRole('button', { name: 'Exportar 1 archivo' });
  await waitFor(() => expect(fill).not.toBeDisabled());
  expect(
    vi.mocked(nestInWorker).mock.calls.at(-1)![0].fillers![0]!.priority,
  ).toBe(2);

  fireEvent.change(screen.getByLabelText('Cantidad de logo.png'), {
    target: { value: '2' },
  });
  expect(screen.queryByText('PENDIENTE DE OPTIMIZAR')).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Resultado de optimización' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Exportar 1 archivo' })).not.toBeInTheDocument();
  expect(screen.queryByText('LISTO PARA EXPORTAR')).not.toBeInTheDocument();
  expect(screen.queryByText(/^\+\d+$/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Optimizar batch' }));
  await screen.findByRole('button', { name: 'Exportar 1 archivo' });
  fireEvent.change(screen.getByLabelText('Tela de logo.png'), {
    target: { value: 'polar' },
  });
  expect(screen.queryByText('LISTO PARA EXPORTAR')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Optimizar batch' }));
  await screen.findByRole('button', { name: 'Exportar 1 archivo' });
  fireEvent.click(screen.getByRole('button', { name: 'Eliminar logo.png' }));
  expect(screen.queryByText('LISTO PARA EXPORTAR')).not.toBeInTheDocument();
  expect(screen.queryByText('logo.png')).not.toBeInTheDocument();
  expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:free');
  view.unmount();
  expect(revoke).toHaveBeenCalledOnce();
});
