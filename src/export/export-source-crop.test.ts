import { afterEach, expect, it, vi } from 'vitest';
import { mm } from '../domain/units';
import { prepareExportSourceBlob } from './export-source-crop';

const definition = {
  kind: 'free-png' as const,
  id: 'source',
  fabric: 'set',
  quantity: 1,
  fileName: 'source.png',
  imageUrl: 'blob:source',
  sourceWidthPx: 20,
  sourceHeightPx: 10,
  physicalWidthMm: mm(20),
  physicalHeightMm: mm(10),
  alphaThreshold: 16,
  simplificationTolerancePx: 1.5,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('reutiliza la fuente exacta cuando no hay borde transparente exterior', async () => {
  const blob = new Blob(['original'], { type: 'image/png' });
  const result = await prepareExportSourceBlob(
    blob,
    definition,
    undefined,
    new AbortController().signal,
  );
  expect(result).toEqual({ blob, width: 20, height: 10 });
});

it('recorta sólo el rectángulo alpha solicitado y conserva todos sus píxeles', async () => {
  const close = vi.fn();
  const drawImage = vi.fn();
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ close })),
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage,
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
    (callback) => callback(new Blob(['cropped'], { type: 'image/png' })),
  );

  const result = await prepareExportSourceBlob(
    new Blob(['original'], { type: 'image/png' }),
    definition,
    {
      xPx: 3,
      yPx: 2,
      widthPx: 12,
      heightPx: 7,
      xMm: 3,
      yMm: 2,
      widthMm: 12,
      heightMm: 7,
    },
    new AbortController().signal,
  );

  expect(createImageBitmap).toHaveBeenCalledWith(
    expect.any(Blob),
    3,
    2,
    12,
    7,
    expect.objectContaining({ colorSpaceConversion: 'none' }),
  );
  expect(drawImage).toHaveBeenCalledOnce();
  expect(result.width).toBe(12);
  expect(result.height).toBe(7);
  expect(await result.blob.text()).toBe('cropped');
  expect(close).toHaveBeenCalledOnce();
});
