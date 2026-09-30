import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
import { buildDesignCollection, type DesignCollection } from './design-collection-state';
import { preflightBatch } from '../export/export-plan';
import { buildContourCacheKey, saveCachedContourPair } from '../persistence/contour-cache';
import { getPolygonBounds } from '../geometry/polygon-transform';

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

function namedBackCollection(withCanonicalPair = false): DesignCollection {
  const files = [
    ...(withCanonicalPair ? [
      new File(['front pixels'], 'ARG26E_0014_T8-FRENTE.png', { type: 'image/png' }),
      new File(['standard back pixels'], 'ARG26E_0015_T8-DORSO.png', { type: 'image/png' }),
    ] : []),
    new File(['BENJI edited pixels'], 'aanomBENJI ARG26E_0015_T8-DORSO.png', { type: 'image/png' }),
    new File(['CHICHA edited pixels'], 'aanomCHICHA ARG26E_0015_T8-DORSO.png', { type: 'image/png' }),
    new File(['arbitrary'], 'JUAN.png', { type: 'image/png' }),
  ];
  for (const file of files) Object.defineProperty(file, 'webkitRelativePath', { value: `Argentina/${file.name}` });
  return buildDesignCollection(files, 'argentina');
}

function realNamedBackCollection(withCanonicalPair = false): DesignCollection {
  const files = [
    new File(['FIRULAIS edited pixels'], 'aanomFIRULAIS SLE_D_T4.png', { type: 'image/png' }),
    ...(withCanonicalPair ? [
      new File(['front pixels'], 'SLE_0006_T4-FRENTE.png', { type: 'image/png' }),
      new File(['standard back pixels'], 'SLE_0007_T4-DORSO.png', { type: 'image/png' }),
    ] : []),
    new File(['JUAN edited pixels'], 'NOMJUAN_SLE_D_T4.png', { type: 'image/png' }),
    new File(['arbitrary'], 'JUAN.png', { type: 'image/png' }),
  ];
  for (const file of files) Object.defineProperty(file, 'webkitRelativePath', { value: `San Lorenzo Escudo/${file.name}` });
  return buildDesignCollection(files, 'san-lorenzo');
}

function installNamedRasterFixture(nameExtendsSilhouette: boolean): void {
  installGarmentRasterFixture();
  let currentName = '';
  vi.stubGlobal('createImageBitmap', vi.fn(async (file: File) => ({
    width: 100, height: 100, close: vi.fn(), sourceName: file.name,
  })));
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue({
    drawImage: (image: { sourceName: string }) => { currentName = image.sourceName; },
    getImageData: () => {
      const data = new Uint8ClampedArray(100 * 100 * 4);
      for (let y = 10; y < 90; y++) for (let x = 10; x < 90; x++) data[(y * 100 + x) * 4 + 3] = 255;
      if (nameExtendsSilhouette && (currentName.startsWith('aanomBENJI') || currentName === 'aanomFIRULAIS SLE_D_T4.png')) {
        for (let y = 0; y < 5; y++) for (let x = 94; x < 100; x++) data[(y * 100 + x) * 4 + 3] = 255;
      }
      return { width: 100, height: 100, data };
    },
  } as unknown as CanvasRenderingContext2D);
}

it.each([[false, false], [true, false], [true, true]])('adds an edited BACK without FRONT; exact preview/export, bounds and garment counters (extended name=%s, real nom convention=%s)', async (extendsSilhouette, realConvention) => {
  window.sessionStorage.removeItem('nestra.batch.collection-quantities');
  installNamedRasterFixture(extendsSilhouette);
  const collection = realConvention ? realNamedBackCollection() : namedBackCollection();
  const edited = collection.replacementAssets![0]!;
  const view = render(<BatchPage templates={[]} collections={[collection]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Agregar reposición' }));
  const fields = within(screen.getByRole('form', { name: 'Agregar reposición' }));
  expect(fields.getByLabelText('Talle')).toHaveValue(edited.size);
  expect(fields.getByLabelText('Lado')).toHaveValue('back');
  const selector = fields.getByLabelText('Archivo de Biblioteca');
  expect(within(selector).getAllByRole('option')).toHaveLength(2);
  expect(within(selector).queryByRole('option', { name: /JUAN\.png/ })).not.toBeInTheDocument();
  fireEvent.change(selector, { target: { value: edited.relativePath } });
  fireEvent.change(fields.getByLabelText('Cantidad'), { target: { value: '2' } });
  fireEvent.click(fields.getByRole('button', { name: 'Agregar pieza' }));
  await waitFor(() => expect(view.container.querySelectorAll('.replacement-piece-list li')).toHaveLength(1));
  const row = view.container.querySelector('.replacement-piece-list li') as HTMLElement;
  expect(row).toHaveTextContent(edited.fileName);
  const sourceUrl = row.querySelector('img')!.getAttribute('src');
  expect(vi.mocked(URL.createObjectURL).mock.calls.some(([file]) => file === edited.file)).toBe(true);
  vi.mocked(nestInWorker).mockImplementationOnce(async input => nestMultiplePieces({ ...input, diagnosticProfiling: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Optimizar batch' }));
  await screen.findByText(/0\/0 prendas colocadas · 2\/2 reposiciones colocadas/);
  await waitFor(() => expect(currentExportButton()).toBeEnabled());
  const input = vi.mocked(nestInWorker).mock.calls.at(-1)![0];
  expect(input.pieces).toHaveLength(2);
  for (const piece of input.pieces) {
    expect(piece.kind).toBe('garment');
    expect(piece.allowedRotations).toEqual([0, 180]);
    expect(piece.polygon.length).toBeGreaterThanOrEqual(4);
    expect(piece.finePolygon!.length).toBeGreaterThanOrEqual(4);
    expect(piece).not.toHaveProperty('collisionComponents');
  }
  const nested = await vi.mocked(nestInWorker).mock.results.at(-1)!.value;
  expect(nested.diagnostics.componentsOverlapCalls).toBe(0);
  expect(nested.diagnostics.componentPairExactChecks).toBe(0);
  expect(nested.placedCount).toBe(2);
  console.info(`EDITED_BACK_PATH ${JSON.stringify({ extendedName: extendsSilhouette, rotations: input.pieces[0]!.allowedRotations.length, componentOverlapCalls: nested.diagnostics.componentsOverlapCalls, componentPairExactChecks: nested.diagnostics.componentPairExactChecks })}`);
  expect(view.container.querySelectorAll('.batch-export-artwork image')).toHaveLength(2);
  for (const image of view.container.querySelectorAll('.batch-export-artwork image')) expect(image).toHaveAttribute('href', sourceUrl);
  expect(chooseFreePng).not.toHaveBeenCalled();
  fireEvent.click(currentExportButton()!);
  await screen.findByRole('button', { name: '1 archivo exportado' });
  const exported = vi.mocked(exportPdfPrototype).mock.calls.at(-1)![0];
  expect(exported.definitions).toEqual([expect.objectContaining({
    kind: 'replacement-piece', collectionId: collection.id, size: edited.size, side: 'back',
    quantity: 2, fileName: edited.fileName, imageUrl: sourceUrl,
  })]);
  const definition = exported.definitions[0]!;
  const expectedBounds = extendsSilhouette
    ? { x: 10, y: 0, width: 90, height: 90 }
    : { x: 10, y: 10, width: 80, height: 80 };
  expect(exported.sourceAlphaBounds!.get(definition.id)).toEqual(expectedBounds);
  expect(exported.sourcePlacementBounds!.get(definition.id)).toEqual(expectedBounds);
  const report = preflightBatch(exported);
  expect(report.errors).toEqual([]);
  expect(report.layouts[0]!.pieces.every(art => art.definition.imageUrl === sourceUrl)).toBe(true);
  expect(report.layouts[0]!.pieces[0]!.sourceCrop).toMatchObject({ xPx: expectedBounds.x, yPx: expectedBounds.y, widthPx: expectedBounds.width, heightPx: expectedBounds.height });
  expect(getPolygonBounds(exported.polygons.get(definition.id)!).maxX).toBeCloseTo((expectedBounds.x + expectedBounds.width) * definition.physicalWidthMm / definition.sourceWidthPx);
  expect(buildContourCacheKey).toHaveBeenCalledWith(edited.file, expect.objectContaining({ geometryMode: 'all-visible-replacement' }));
  expect(saveCachedContourPair).toHaveBeenCalledWith('test', expect.objectContaining({ sourceAlphaBounds: expectedBounds, sourcePlacementBounds: expectedBounds }));

  fireEvent.change(within(row).getByLabelText('Cantidad'), { target: { value: '3' } });
  expect(currentExportButton()).not.toBeInTheDocument();
  expect(view.container.querySelector('.batch-export-artwork')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Optimizar batch' }));
  await screen.findByText(/0\/0 prendas colocadas · 3\/3 reposiciones colocadas/);
  await waitFor(() => expect(currentExportButton()).toBeEnabled());
  fireEvent.change(within(row).getByLabelText('Tela'), { target: { value: 'polar' } });
  expect(currentExportButton()).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Optimizar batch' }));
  await waitFor(() => expect(currentExportButton()).toBeEnabled());
  fireEvent.click(within(row).getByRole('button', { name: /Eliminar reposición/ }));
  expect(currentExportButton()).not.toBeInTheDocument();
  expect(view.container.querySelector('.replacement-piece-list')).not.toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith(sourceUrl);
});

it.each([false, true])('mixes standard and two edited BACK sources, a normal garment and a required free-PNG on the same fabric (real nom convention=%s)', async realConvention => {
  window.sessionStorage.removeItem('nestra.batch.collection-quantities');
  installNamedRasterFixture(true);
  const collection = realConvention ? realNamedBackCollection(true) : namedBackCollection(true);
  const view = render(<BatchPage templates={[]} collections={[collection]} />);
  fireEvent.change(screen.getByLabelText(`Cantidad ${collection.assets[0]!.size}`), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Agregar reposición' }));
  fireEvent.change(screen.getByLabelText('Lado'), { target: { value: 'back' } });
  const selector = screen.getByLabelText('Archivo de Biblioteca');
  expect(within(selector).getAllByRole('option').map(option => option.textContent)).toEqual([
    collection.assets[1]!.relativePath,
    ...collection.replacementAssets!.map(asset => asset.relativePath),
  ]);
  for (const path of [collection.assets[1]!.relativePath, ...collection.replacementAssets!.map(asset => asset.relativePath)]) {
    fireEvent.change(selector, { target: { value: path } });
    fireEvent.click(screen.getByRole('button', { name: 'Agregar pieza' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Agregar pieza' })).toBeEnabled());
  }
  expect(view.container.querySelectorAll('.replacement-piece-list li')).toHaveLength(3);
  vi.mocked(chooseFreePng).mockResolvedValueOnce({
    kind: 'free-png', id: 'free-logo', file: new File(['logo'], 'logo.png', { type: 'image/png' }),
    imageUrl: 'blob:free-logo', sourceWidthPx: 100, sourceHeightPx: 100, quantity: 1, fabric: 'set',
  });
  fireEvent.click(screen.getByRole('button', { name: 'Agregar PNG' }));
  await screen.findByText('logo.png');
  fireEvent.click(screen.getByRole('button', { name: 'Optimizar batch' }));
  await screen.findByText(/1\/1 prendas colocadas · 3\/3 reposiciones colocadas · 1\/1 PNG requeridos colocados/);
  await waitFor(() => expect(currentExportButton()).toBeEnabled());
  const inputs = vi.mocked(nestInWorker).mock.calls;
  expect(inputs).toHaveLength(1);
  expect(inputs[0]![0].pieces).toHaveLength(6);
  expect(inputs[0]![0].pieces.filter(piece => piece.kind === 'free-png')).toHaveLength(1);
  fireEvent.click(currentExportButton()!);
  await screen.findByRole('button', { name: '1 archivo exportado' });
  const exported = vi.mocked(exportPdfPrototype).mock.calls.at(-1)![0];
  expect(exported.results).toHaveLength(1);
  expect(exported.definitions.filter(piece => piece.kind === 'garment').map(piece => piece.fileName)).toEqual([
    ...collection.assets.map(asset => asset.fileName),
  ]);
  const replacements = exported.definitions.filter(piece => piece.kind === 'replacement-piece');
  expect(replacements.map(piece => piece.fileName)).toEqual([
    collection.assets[1]!.fileName, ...collection.replacementAssets!.map(asset => asset.fileName),
  ]);
  expect(new Set(replacements.map(piece => piece.imageUrl)).size).toBe(3);
  expect(preflightBatch(exported).errors).toEqual([]);
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

it('agrega y optimiza un dorso de reposición sin exigir frente counterpart', async () => {
  window.sessionStorage.removeItem('nestra.batch.collection-quantities');
  installGarmentRasterFixture();
  const view = render(<BatchPage templates={[]} collections={[garmentCollectionFixture()]} />);

  fireEvent.click(screen.getByRole('button', { name: 'Agregar reposición' }));
  fireEvent.change(screen.getByLabelText('Diseño'), { target: { value: 'fixture' } });
  fireEvent.change(screen.getByLabelText('Talle'), { target: { value: 'T8' } });
  fireEvent.change(screen.getByLabelText('Lado'), { target: { value: 'back' } });
  fireEvent.change(screen.getByLabelText('Cantidad', { selector: 'input' }), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Agregar pieza' }));

  expect(await screen.findByText('Fixture · T8 · Dorso')).toBeInTheDocument();
  const replacementForm = screen.getByRole('form', { name: 'Agregar reposición' });
  const replacementFields = within(replacementForm);
  expect(replacementForm).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Reposición agregada. Podés cargar otra.');
  expect(replacementFields.getByLabelText('Diseño')).toHaveValue('fixture');
  expect(replacementFields.getByLabelText('Talle')).toHaveValue('T8');
  expect(replacementFields.getByLabelText('Lado')).toHaveValue('back');
  expect(replacementFields.getByLabelText('Tela')).toHaveValue('set');
  expect(replacementFields.getByLabelText('Cantidad', { selector: 'input' })).toHaveValue(1);
  expect(replacementFields.getByLabelText('Cantidad', { selector: 'input' })).toHaveFocus();

  fireEvent.change(replacementFields.getByLabelText('Cantidad', { selector: 'input' }), { target: { value: '1' } });
  fireEvent.submit(replacementForm);
  await screen.findByRole('status');
  await waitFor(() => expect(view.container.querySelectorAll('.replacement-piece-list .free-png-row')).toHaveLength(2));
  expect(screen.getByRole('form', { name: 'Agregar reposición' })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Optimizar batch' }));

  await screen.findByText(/0\/0 prendas colocadas · 3\/3 reposiciones colocadas/);
  await waitFor(() => expect(currentExportButton()).toBeEnabled());
  const nestingInput = vi.mocked(nestInWorker).mock.calls.at(-1)?.[0];
  expect(nestingInput?.pieces).toHaveLength(3);
  expect(nestingInput?.pieces[0]).toMatchObject({ kind: 'garment', allowedRotations: [0, 180] });
  expect(nestingInput?.pieces[0]).not.toHaveProperty('collisionComponents');
  expect(view.container.querySelectorAll('.batch-export-layout').length).toBeGreaterThan(0);

  const firstReplacement = view.container.querySelector('.replacement-piece-list .free-png-row');
  expect(firstReplacement).not.toBeNull();
  fireEvent.change(within(firstReplacement as HTMLElement).getByLabelText('Cantidad'), { target: { value: '3' } });
  expect(currentExportButton()).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Optimizar batch' }));
  await screen.findByText(/0\/0 prendas colocadas · 4\/4 reposiciones colocadas/);
  await waitFor(() => expect(currentExportButton()).toBeEnabled());
});

it('permite quitar una reposición de la lista antes de optimizar', async () => {
  window.sessionStorage.removeItem('nestra.batch.collection-quantities');
  installGarmentRasterFixture();
  render(<BatchPage templates={[]} collections={[garmentCollectionFixture()]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Agregar reposición' }));
  fireEvent.click(screen.getByRole('button', { name: 'Agregar pieza' }));
  expect(await screen.findByText('Fixture · T8 · Frente')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Eliminar reposición Fixture T8 Frente' }));
  expect(screen.queryByText('Fixture · T8 · Frente')).not.toBeInTheDocument();
});

it('cancela el panel con el botón o Escape y devuelve el foco al control', () => {
  render(<BatchPage templates={[]} collections={[garmentCollectionFixture()]} />);
  const trigger = screen.getByRole('button', { name: 'Agregar reposición' });
  fireEvent.click(trigger);
  expect(screen.getByLabelText('Diseño')).toHaveFocus();
  fireEvent.keyDown(screen.getByRole('form', { name: 'Agregar reposición' }), { key: 'Escape' });
  expect(screen.queryByRole('form', { name: 'Agregar reposición' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Agregar reposición' })).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Agregar reposición' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  expect(screen.queryByRole('form', { name: 'Agregar reposición' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Agregar reposición' })).toHaveFocus();
});

it('muestra errores de validación sin cerrar ni limpiar la reposición', async () => {
  installGarmentRasterFixture();
  render(<BatchPage templates={[]} collections={[garmentCollectionFixture()]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Agregar reposición' }));
  fireEvent.change(screen.getByLabelText('Cantidad', { selector: 'input' }), { target: { value: '0' } });
  fireEvent.submit(screen.getByRole('form', { name: 'Agregar reposición' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('cantidad entera mayor que cero');
  expect(screen.getByRole('form', { name: 'Agregar reposición' })).toBeInTheDocument();
  expect(screen.getByLabelText('Cantidad', { selector: 'input' })).toHaveValue(0);
  fireEvent.change(screen.getByLabelText('Cantidad', { selector: 'input' }), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('Tela'), { target: { value: ' ' } });
  fireEvent.submit(screen.getByRole('form', { name: 'Agregar reposición' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('tela');
  expect(screen.getByRole('form', { name: 'Agregar reposición' })).toBeInTheDocument();
});

it('bloquea el doble envío y conserva el panel si falla la lectura del PNG', async () => {
  installGarmentRasterFixture();
  const bitmap = vi.fn(() => Promise.reject(new Error('Falló la lectura de prueba.')));
  vi.stubGlobal('createImageBitmap', bitmap);
  render(<BatchPage templates={[]} collections={[garmentCollectionFixture()]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Agregar reposición' }));
  const form = screen.getByRole('form', { name: 'Agregar reposición' });
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(bitmap).toHaveBeenCalledTimes(1);
  expect(await screen.findByRole('alert')).toHaveTextContent('Falló la lectura de prueba.');
  expect(screen.getByRole('form', { name: 'Agregar reposición' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Agregar pieza' })).toBeEnabled();
});

it('indica carga y desactiva el formulario mientras prepara la reposición', async () => {
  installGarmentRasterFixture();
  let finishBitmap!: (image: { width: number; height: number; close: () => void }) => void;
  const bitmap = vi.fn(() => new Promise<{ width: number; height: number; close: () => void }>(resolve => { finishBitmap = resolve; }));
  vi.stubGlobal('createImageBitmap', bitmap);
  render(<BatchPage templates={[]} collections={[garmentCollectionFixture()]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Agregar reposición' }));
  fireEvent.submit(screen.getByRole('form', { name: 'Agregar reposición' }));
  expect(screen.getByRole('button', { name: 'Agregando…' })).toBeDisabled();
  expect(screen.getByLabelText('Diseño')).toBeDisabled();
  finishBitmap({ width: 100, height: 100, close: vi.fn() });
  expect(await screen.findByRole('status')).toHaveTextContent('Reposición agregada. Podés cargar otra.');
  expect(screen.getByRole('form', { name: 'Agregar reposición' })).toBeInTheDocument();
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
