import { afterEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { chooseFreePng } from './free-png-import';
import { physicalSizeFromSourcePixels } from '../domain/source-image-size';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('returns cancellation without reading an image or allocating a URL', async () => {
  vi.mocked(invoke).mockResolvedValueOnce(null);
  const bitmap = vi.fn();
  vi.stubGlobal('createImageBitmap', bitmap);
  expect(await chooseFreePng(3)).toBeNull();
  expect(bitmap).not.toHaveBeenCalled();
});

it('keeps the native PNG bytes in one File, closes the bitmap and creates one URL', async () => {
  vi.mocked(invoke).mockResolvedValueOnce({
    fileName: 'logo.png',
    bytes: [137, 80, 78, 71],
  });
  const close = vi.fn();
  const bitmap = vi.fn().mockResolvedValue({ width: 72, height: 144, close });
  vi.stubGlobal('createImageBitmap', bitmap);
  const url = vi.fn().mockReturnValue('blob:free');
  vi.stubGlobal('URL', { createObjectURL: url });
  const result = await chooseFreePng(3);
  expect(invoke).toHaveBeenCalledWith('choose_free_png');
  expect(result).toMatchObject({
    kind: 'free-png',
    quantity: 3,
    fabric: 'set',
    sourceWidthPx: 72,
    sourceHeightPx: 144,
  });
  expect(result).not.toHaveProperty('side');
  expect(bitmap).toHaveBeenCalledWith(result!.file);
  expect(url).toHaveBeenCalledExactlyOnceWith(result!.file);
  expect(close).toHaveBeenCalledOnce();
});

it('rejects oversized images and releases the decode without allocating a URL', async () => {
  vi.mocked(invoke).mockResolvedValueOnce({
    fileName: 'huge.png',
    bytes: [137, 80, 78, 71],
  });
  const close = vi.fn();
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn().mockResolvedValue({ width: 20000, height: 20000, close }),
  );
  const url = vi.fn();
  vi.stubGlobal('URL', { createObjectURL: url });
  await expect(chooseFreePng(1)).rejects.toThrow('20000 × 20000 px (400,0 MP). Máximo admitido: 64 MP.');
  expect(close).toHaveBeenCalledOnce();
  expect(url).not.toHaveBeenCalled();
});

it.each([[4195, 14173], [8000, 8000]])('accepts %i × %i source pixels without changing dimensions', async (width, height) => {
  vi.mocked(invoke).mockResolvedValueOnce({ fileName: 'large.png', bytes: [137, 80, 78, 71] });
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width, height, close: vi.fn() }));
  vi.stubGlobal('URL', { createObjectURL: vi.fn().mockReturnValue('blob:large') });
  expect(await chooseFreePng(1)).toMatchObject({ sourceWidthPx: width, sourceHeightPx: height });
  const physical = physicalSizeFromSourcePixels(width, height);
  expect(physical.widthMm).toBeCloseTo(width * 25.4 / 72, 8);
  expect(physical.heightMm).toBeCloseTo(height * 25.4 / 72, 8);
});

it('reports decode failures separately from oversized images', async () => {
  vi.mocked(invoke).mockResolvedValueOnce({ fileName: 'invalid.png', bytes: [] });
  vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('decode')));
  await expect(chooseFreePng(1)).rejects.toThrow('PNG inválido o no compatible.');
});
