import { afterEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { invoke } from '@tauri-apps/api/core';
import { exportPdfPrototype } from './pdf-prototype';
import {
  freePngDefinition,
  prepareFreePngBatch,
} from '../test/free-png-fixture';
import { nativePngPlan } from './native-png-export';
import { preflightBatch } from './export-plan';
import { fillBatch, fillDefinition } from '../test/fill-gaps-fixture';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: () => true,
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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
