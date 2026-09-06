import { afterEach, expect, it, vi } from 'vitest';
import type {
  MultiNestingInput,
  MultiNestingResult,
} from './multi-piece-nesting-engine';

afterEach(() => vi.unstubAllGlobals());

it('disables profiling by default and honors explicit opt-in and opt-out', async () => {
  const postMessage = vi.fn();

  const worker = {
    postMessage,
    onmessage: vi.fn<(event: MessageEvent<MultiNestingInput>) => void>(),
  };

  vi.stubGlobal('self', worker);

  await import('./nesting-worker');

  const input: MultiNestingInput = {
    canvas: { width: 100, height: 100 },
    pieces: [
      {
        id: 'a',
        allowedRotations: [0, 180],
        polygon: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ],
      },
    ],
  };

  worker.onmessage({
    data: input,
  } as MessageEvent<MultiNestingInput>);

  const plainDefault = postMessage.mock.calls[0]![0] as {
    result: MultiNestingResult;
    workerMs: number;
  };

  expect(
    plainDefault.result.diagnostics!.profile,
  ).toBeUndefined();

  expect(
    JSON.parse(JSON.stringify(plainDefault)),
  ).toEqual(plainDefault);

  worker.onmessage({
    data: {
      ...input,
      diagnosticProfiling: true,
    },
  } as MessageEvent<MultiNestingInput>);

  const measured = postMessage.mock.calls[1]![0] as typeof plainDefault;

  expect(
    measured.result.diagnostics!.profile,
  ).toBeDefined();

  expect(measured.workerMs).toBeGreaterThanOrEqual(
    measured.result.diagnostics!.profile!.totalMs,
  );

  expect(
    JSON.parse(JSON.stringify(measured)),
  ).toEqual(measured);

  expect(measured.result.layouts).toEqual(
    plainDefault.result.layouts,
  );

  worker.onmessage({
    data: {
      ...input,
      diagnosticProfiling: false,
    },
  } as MessageEvent<MultiNestingInput>);

  const plainExplicit = postMessage.mock.calls[2]![0] as typeof plainDefault;

  expect(
    plainExplicit.result.diagnostics!.profile,
  ).toBeUndefined();

  expect(plainExplicit.result.layouts).toEqual(
    plainDefault.result.layouts,
  );
});