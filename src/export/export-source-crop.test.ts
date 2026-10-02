import { afterEach, expect, it, vi } from 'vitest';
import { mm } from '../domain/units';
import { createSizeMarkGlyph } from '../domain/size-mark-raster';
import { prepareExportSourceBlob, suppressEmbeddedSizeMark } from './export-source-crop';

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

it('suprime sólo la tinta verde embebida antes de exportar y conserva alpha y huecos del glifo', () => {
  const mask = createSizeMarkGlyph('T1');
  const width = mask.width + 4;
  const height = 22;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    rgba[pixel * 4] = 20;
    rgba[pixel * 4 + 1] = 40;
    rgba[pixel * 4 + 2] = 60;
    rgba[pixel * 4 + 3] = 200;
  }
  const x = 2;
  const y = 2;
  for (let my = 0; my < mask.height; my++) for (let mx = 0; mx < mask.width; mx++) {
    if (!mask.data[my * mask.width + mx]) continue;
    const offset = ((y + my) * width + x + mx) * 4;
    rgba[offset] = 138;
    rgba[offset + 1] = 255;
    rgba[offset + 2] = 0;
  }
  const metadata = { version: 1 as const, size: 'T1' as const, x, y, width: mask.width, height: mask.height };
  const clean = suppressEmbeddedSizeMark(rgba, width, height, metadata);
  for (let my = 0; my < mask.height; my++) for (let mx = 0; mx < mask.width; mx++) {
    const offset = ((y + my) * width + x + mx) * 4;
    expect([...clean.slice(offset, offset + 4)]).toEqual(mask.data[my * mask.width + mx]
      ? [255, 255, 255, 200]
      : [rgba[offset]!, rgba[offset + 1]!, rgba[offset + 2]!, 200]);
  }
});

it('rechaza un PNG original cuyo glifo no coincide con la metadata #8aff00 antes de limpiarlo', () => {
  const mask = createSizeMarkGlyph('T1');
  const width = mask.width + 2;
  const height = mask.height;
  const rgba = new Uint8ClampedArray(width * height * 4);
  rgba.fill(200);
  for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) {
    if (!mask.data[y * mask.width + x]) continue;
    const offset = (y * width + x) * 4;
    rgba[offset] = 138;
    rgba[offset + 1] = 255;
    rgba[offset + 2] = 0;
  }
  const inkIndex = mask.data.findIndex(value => value !== 0);
  const inkX = inkIndex % mask.width;
  const inkY = Math.floor(inkIndex / mask.width);
  rgba[(inkY * width + inkX) * 4] = 255;
  const metadata = { version: 1 as const, size: 'T1' as const, x: 0, y: 0, width: mask.width, height: mask.height };
  expect(() => suppressEmbeddedSizeMark(rgba, width, height, metadata)).toThrow(
    'El PNG original no coincide con la máscara #8aff00 de metadata (T1).',
  );
});

it('acepta la cuantización de #8aff00 causada por premultiplicación alfa en Canvas', () => {
  const mask = createSizeMarkGlyph('T1');
  const rgba = new Uint8ClampedArray(mask.width * mask.height * 4);
  for (let index = 0; index < mask.data.length; index++) {
    const offset = index * 4;
    rgba[offset + 3] = 17;
    if (mask.data[index]) rgba.set([135, 255, 0, 17], offset);
  }
  const clean = suppressEmbeddedSizeMark(rgba, mask.width, mask.height, {
    version: 1,
    size: 'T1',
    x: 0,
    y: 0,
    width: mask.width,
    height: mask.height,
  });
  for (let index = 0; index < mask.data.length; index++) {
    const offset = index * 4;
    expect([...clean.slice(offset, offset + 4)]).toEqual(mask.data[index]
      ? [255, 255, 255, 17]
      : [0, 0, 0, 17]);
  }
});

it('acepta el redondeo por piso exacto de WebView2 para Argentina Messi T8 y sigue rechazando otro color', () => {
  const mask = createSizeMarkGlyph('T8');
  const rgba = new Uint8ClampedArray(mask.width * mask.height * 4);
  for (let index = 0; index < mask.data.length; index++) {
    if (mask.data[index]) rgba.set([138, 255, 0, 255], index * 4);
  }

  // Real PNG pixel at source (622, 101): #8aff00 / alpha 158 is read back by
  // the default export Canvas as #89ff00 / alpha 158 after 8-bit premultiplication.
  const affectedIndex = 6;
  expect(mask.data[affectedIndex]).toBe(255);
  rgba.set([137, 255, 0, 158], affectedIndex * 4);
  const metadata = {
    version: 1 as const,
    size: 'T8' as const,
    x: 0,
    y: 0,
    width: mask.width,
    height: mask.height,
  };

  const clean = suppressEmbeddedSizeMark(rgba, mask.width, mask.height, metadata);
  expect([...clean.slice(affectedIndex * 4, affectedIndex * 4 + 4)]).toEqual([255, 255, 255, 158]);

  const incompatible = new Uint8ClampedArray(rgba);
  incompatible.set([136, 255, 0, 158], affectedIndex * 4);
  expect(() => suppressEmbeddedSizeMark(incompatible, mask.width, mask.height, metadata)).toThrow(
    'El PNG original no coincide con la máscara #8aff00 de metadata (T8).',
  );
});

it('prepara para export el artwork limpio conservando alpha para reconstruir el overlay por separado', async () => {
  const mask = createSizeMarkGlyph('T1');
  const width = mask.width + 2;
  const height = mask.height + 2;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    rgba.set([40, 60, 80, 200], pixel * 4);
  }
  const x = 1;
  const y = 1;
  for (let my = 0; my < mask.height; my++) for (let mx = 0; mx < mask.width; mx++) {
    if (!mask.data[my * mask.width + mx]) continue;
    rgba.set([138, 255, 0, 200], ((y + my) * width + x + mx) * 4);
  }
  const putImageData = vi.fn<(data: ImageData) => void>();
  const canvasContext = {
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(rgba) })),
    putImageData,
  };
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ close: vi.fn() })));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    canvasContext as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
    callback => callback(new Blob(['clean artwork'], { type: 'image/png' })),
  );
  const prepared = await prepareExportSourceBlob(
    new Blob(['canonical']),
    { ...definition, sourceWidthPx: width, sourceHeightPx: height },
    undefined,
    new AbortController().signal,
    { version: 1, size: 'T1', x, y, width: mask.width, height: mask.height },
  );
  expect(await prepared.blob.text()).toBe('clean artwork');
  const cleanPixels = putImageData.mock.calls[0]?.[0].data as Uint8ClampedArray;
  for (let my = 0; my < mask.height; my++) for (let mx = 0; mx < mask.width; mx++) {
    const offset = ((y + my) * width + x + mx) * 4;
    expect([...cleanPixels.slice(offset, offset + 4)]).toEqual(mask.data[my * mask.width + mx]
      ? [255, 255, 255, 200]
      : [40, 60, 80, 200]);
  }
});
