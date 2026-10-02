import { afterEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { invoke } from '@tauri-apps/api/core';
import { exportPdfPrototype } from './pdf-prototype';
import {
  freePngDefinition,
  prepareFreePngBatch,
} from '../test/free-png-fixture';
import { nativePngPlan } from './native-png-export';
import { preflightBatch, PX_PER_MM } from './export-plan';
import { fillBatch, fillDefinition } from '../test/fill-gaps-fixture';
import { laserBatch } from '../test/imprenta-2-fixture';
import { DEFAULT_IMPRENTA_2_PROFILE, nestingCanvasForProfile } from '../domain/canvas-profile';
import { nestMultiplePieces } from '../geometry/multi-piece-nesting-engine';
import { appendSizeMarkPngMetadata } from '../domain/size-mark-metadata';
import { createSizeMarkGlyph } from '../domain/size-mark-raster';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: () => true,
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(data.length + 12);
  new DataView(bytes.buffer).setUint32(0, data.length, false);
  bytes.set(new TextEncoder().encode(type), 4);
  bytes.set(data, 8);
  return bytes;
}

async function markedPng(width: number, height: number, metadata: {
  readonly version: 1;
  readonly size: `T${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10}`;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}): Promise<Blob> {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, height, false);
  header.set([8, 6, 0, 0, 0], 8);
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const png = new Uint8Array([
    ...signature,
    ...pngChunk('IHDR', header),
    ...pngChunk('IDAT', new Uint8Array()),
    ...pngChunk('IEND', new Uint8Array()),
  ]);
  return appendSizeMarkPngMetadata(new Blob([png], { type: 'image/png' }), metadata);
}

it('sends every laser contour and the configured width to PDF through the shared native PNG plan', async () => {
  const batch = laserBatch();
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('fetch', vi.fn(async () => ({ok:true,arrayBuffer:async()=>new Uint8Array([137,80,78,71]).buffer})));
  vi.spyOn(console,'info').mockImplementation(()=>{});
  vi.mocked(invoke).mockImplementation(async command => {
    if (command==='begin_pdf_prototype') return 'laser';
    if (command==='finish_pdf_prototype') return {path:'laser.pdf',outputBytes:100,totalMs:1};
    return undefined;
  });
  expect(await exportPdfPrototype(batch,new AbortController().signal,vi.fn())).toEqual(['laser.pdf']);
  const expected=nativePngPlan(preflightBatch(batch).layouts[0]!,new Map([['cut',0]]));
  expect(expected.laserOutline!.contours).toHaveLength(2);
  expect(invoke).toHaveBeenCalledWith('finish_pdf_prototype',{id:'laser',plan:expected});
});

it('prepara un PNG canónico marcado, sube al menos una fuente y alcanza el comando Rust de PDF', async () => {
  const base = laserBatch();
  const baseDefinition = base.definitions[0]!;
  const definition = {
    ...baseDefinition,
    quantity: 1,
    kind: 'garment' as const,
    model: 'Boca 2026',
    size: 'T1' as const,
    side: 'front' as const,
    imageUrl: 'blob:boca-front-t1',
    fileName: 'Boca_2026_T1_FRONT.png',
  };
  const backDefinition = {
    ...definition,
    id: 'cut-back',
    side: 'back' as const,
    imageUrl: 'blob:boca-back-t1',
    fileName: 'Boca_2026_T1_BACK.png',
  };
  const originalPolygon = base.polygons.get(baseDefinition.id)!;
  const batch = {
    ...base,
    definitions: [definition, backDefinition],
    polygons: new Map([[definition.id, originalPolygon], [backDefinition.id, originalPolygon]]),
    cutComponents: new Map([[definition.id, [originalPolygon]], [backDefinition.id, [originalPolygon]]]),
    results: base.results.map(result => ({
      ...result,
      layouts: result.layouts.map(layout => ({
        ...layout,
        pieces: layout.pieces.map((piece, index) => ({
          ...piece,
          pieceId: index === 0 ? 'cut-1' : 'cut-back-1',
        })),
      })),
    })),
  };
  const mask = createSizeMarkGlyph('T1');
  const metadata = {
    version: 1 as const,
    size: 'T1' as const,
    x: 0,
    y: 0,
    width: mask.width,
    height: mask.height,
  };
  const source = await markedPng(100, 100, metadata);
  const backSource = new Blob(['unmarked back source'], { type: 'image/png' });
  const rgba = new Uint8ClampedArray(100 * 100 * 4);
  for (let pixel = 0; pixel < 100 * 100; pixel++) rgba.set([20, 40, 60, 200], pixel * 4);
  for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) {
    if (mask.data[y * mask.width + x] !== 0) {
      // Chromium may read #8aff00 as this equivalent premultiplied-alpha value.
      rgba.set([135, 255, 0, 17], (y * 100 + x) * 4);
    }
  }
  const closeBitmap = vi.fn();
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true,
    blob: async () => url.includes('back') ? backSource : source,
  })));
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ close: closeBitmap })));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(rgba) })),
    putImageData: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback =>
    callback(new Blob(['prepared clean source'], { type: 'image/png' })),
  );
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.mocked(invoke).mockImplementation(async command => {
    if (command === 'begin_pdf_prototype') return 'session';
    if (command === 'finish_pdf_prototype') return { path: 'boca.pdf', outputBytes: 100, totalMs: 1 };
    return undefined;
  });
  const report = preflightBatch(batch);
  expect(report.errors).toEqual([]);
  const progress = vi.fn();

  await expect(exportPdfPrototype(batch, new AbortController().signal, progress, report))
    .resolves.toEqual(['boca.pdf']);

  expect(progress).toHaveBeenCalledWith('Preparando fuentes PDF (0)…');
  expect(progress).toHaveBeenCalledWith('Preparando fuentes PDF (1)…');
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'upload_pdf_source'))
    .toHaveLength(2);
  expect(invoke).toHaveBeenCalledWith('finish_pdf_prototype', {
    id: 'session',
    plan: expect.objectContaining({ sizeMarks: expect.any(Array), sizeMarkMasks: expect.any(Array) }),
  });
  expect(invoke).toHaveBeenLastCalledWith('close_pdf_prototype', { id: 'session' });
  expect(closeBitmap).toHaveBeenCalledOnce();
});

it('conserva la etapa y la pieza exacta cuando falla la primera fuente antes del primer upload', async () => {
  const batch = laserBatch();
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('blob URL inválida'); }));
  vi.mocked(invoke).mockImplementation(async command =>
    command === 'begin_pdf_prototype' ? 'session' : undefined,
  );
  const progress = vi.fn();

  await expect(exportPdfPrototype(batch, new AbortController().signal, progress, preflightBatch(batch)))
    .rejects.toThrow(/fetch de la fuente.*canvas 1\/1; sourceId=cut; cut\.png: blob URL inválida/);

  expect(progress).toHaveBeenCalledWith('Preparando fuentes PDF (0)…');
  expect(invoke).toHaveBeenCalledWith('close_pdf_prototype', { id: 'session' });
});

it('exports every canvas from concatenated fast chunks through the existing PDF workflow', async () => {
  const definition = freePngDefinition(201);
  const polygon = [
    { x: 0, y: 0 },
    { x: definition.physicalWidthMm, y: 0 },
    { x: definition.physicalWidthMm, y: definition.physicalHeightMm },
    { x: 0, y: definition.physicalHeightMm },
  ];
  const canvas = nestingCanvasForProfile(DEFAULT_IMPRENTA_2_PROFILE);
  const nested = nestMultiplePieces({
    canvas,
    searchStrategy: 'fast',
    scanStepMm: 10,
    pieces: Array.from({ length: 201 }, (_, index) => ({
      id: `logo-${index + 1}`,
      kind: 'free-png' as const,
      polygon,
      cutComponents: [polygon],
      allowedRotations: [0] as const,
    })),
  });
  expect(nested.placedCount).toBe(201);
  expect(nested.unplacedPieceIds).toEqual([]);
  expect(nested.layouts.length).toBeGreaterThan(1);

  const batch = {
    profile: DEFAULT_IMPRENTA_2_PROFILE,
    definitions: [definition],
    polygons: new Map([[definition.id, polygon]]),
    cutComponents: new Map([[definition.id, [polygon]]]),
    results: [{
      fabric: definition.fabric,
      elapsedMs: 0,
      unplacedPieceIds: nested.unplacedPieceIds,
      layouts: nested.layouts,
    }],
  };
  const preflight = preflightBatch(batch);
  expect(preflight.errors).toEqual([]);
  const physicalCopiesRepresented = preflight.layouts.reduce((total, layout) => {
    const copies = /_(\d+)_copias\.png$/.exec(layout.name)?.[1];
    return total + layout.pieces.length * Number(copies ?? 1);
  }, 0);
  expect(physicalCopiesRepresented).toBe(201);

  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer })));
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.mocked(invoke).mockImplementation(async command => {
    if (command === 'begin_pdf_prototype') return 'chunked';
    if (command === 'finish_pdf_prototype') return { path: 'chunked.pdf', outputBytes: 100, totalMs: 1 };
    return undefined;
  });
  const paths = await exportPdfPrototype(batch, new AbortController().signal, vi.fn());
  expect(paths).toHaveLength(preflight.layouts.length);
  const plans = vi.mocked(invoke).mock.calls
    .filter(([command]) => command === 'finish_pdf_prototype')
    .map(([, args]) => (args as { plan: ReturnType<typeof nativePngPlan> }).plan);
  expect(plans).toHaveLength(preflight.layouts.length);
  expect(plans.every(plan => plan.laserOutline?.width === 3 * PX_PER_MM)).toBe(true);
  expect(plans.reduce((total, plan) => total + plan.pieces.length, 0)).toBe(physicalCopiesRepresented);
  expect(invoke).toHaveBeenLastCalledWith('close_pdf_prototype', { id: 'chunked' });
});

it('uploads each filler source once and sends every required and extra placement to the same PDF', async () => {
  const batch = fillBatch([
    fillDefinition('base', 60, 100),
    fillDefinition('logo', 20, 20, 3, 1),
  ]);
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      arrayBuffer: async () =>
        new Uint8Array([137, 80, 78, 71, url === 'blob:base' ? 0 : 1]).buffer,
    })),
  );
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === 'begin_pdf_prototype') return 'session';
    if (command === 'finish_pdf_prototype')
      return { path: 'deportiva_1_copia.pdf', outputBytes: 100, totalMs: 1 };
    return undefined;
  });
  const paths = await exportPdfPrototype(
    batch,
    new AbortController().signal,
    vi.fn(),
  );
  expect(paths).toEqual(['deportiva_1_copia.pdf']);
  expect(
    vi
      .mocked(invoke)
      .mock.calls.filter(([command]) => command === 'upload_pdf_source'),
  ).toHaveLength(2);
  const expected = nativePngPlan(
    preflightBatch(batch).layouts[0]!,
    new Map([
      ['base', 0],
      ['logo', 1],
    ]),
  );
  expect(expected.pieces).toHaveLength(11);
  expect(invoke).toHaveBeenCalledWith('finish_pdf_prototype', {
    id: 'session',
    plan: expected,
  });
  expect(invoke).toHaveBeenLastCalledWith('close_pdf_prototype', {
    id: 'session',
  });
});

it('uses the existing PDF upload, deduplication, placement plan and cleanup for free PNGs', async () => {
  const batch = prepareFreePngBatch([
    freePngDefinition(),
    { ...freePngDefinition(1), id: 'second', imageUrl: 'blob:second' },
  ]);
  const bytes = new Uint8Array([137, 80, 78, 71]).buffer;
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, arrayBuffer: async () => bytes })),
  );
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === 'begin_pdf_prototype') return 'session';
    if (command === 'finish_pdf_prototype')
      return { path: 'deportiva_1_copia.pdf', outputBytes: 100, totalMs: 1 };
    return undefined;
  });
  const paths = await exportPdfPrototype(
    batch,
    new AbortController().signal,
    vi.fn(),
  );
  expect(paths).toEqual(['deportiva_1_copia.pdf']);
  expect(
    vi
      .mocked(invoke)
      .mock.calls.filter(([command]) => command === 'upload_pdf_source'),
  ).toHaveLength(1);
  const expected = nativePngPlan(
    preflightBatch(batch).layouts[0]!,
    new Map([
      ['logo', 0],
      ['second', 0],
    ]),
  );
  expect(expected.pieces).toHaveLength(4);
  expect(invoke).toHaveBeenCalledWith('finish_pdf_prototype', {
    id: 'session',
    plan: expected,
  });
  expect(invoke).toHaveBeenLastCalledWith('close_pdf_prototype', {
    id: 'session',
  });
});
