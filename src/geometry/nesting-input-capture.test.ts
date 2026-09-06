import { afterEach, expect, it, vi } from 'vitest';
import { captureNestingInput } from './nesting-input-capture';
import { nestInWorker } from './nesting-client';
import type { MultiNestingInput } from './multi-piece-nesting-engine';

afterEach(() => vi.unstubAllGlobals());

const input: MultiNestingInput = Object.freeze({
  canvas: Object.freeze({ width: 1480, height: 1000 }),
  scanStepMm: 10,
  pieces: Object.freeze([Object.freeze({
    id: 'real-order-1',
    allowedRotations: Object.freeze([0, 180] as const),
    polygon: Object.freeze([
      Object.freeze({ x: 0.125, y: 0 }),
      Object.freeze({ x: 100, y: 0 }),
      Object.freeze({ x: 0, y: 100.25 }),
    ]),
  })]),
});

function enable() {
  const session = { enabled: true, runs: [] as {
    json: string;
    sameInputAsPrevious: boolean | null;
    sameGeometryAndOrderAsPrevious: boolean | null;
  }[] };
  vi.stubGlobal('__nestraNestingCapture', session);
  return session;
}

it('round-trips the frozen input and distinguishes IDs from geometry changes', () => {
  const session = enable();
  captureNestingInput(input);
  captureNestingInput(input);
  expect(JSON.parse(session.runs[0]!.json)).toEqual(input);
  expect(session.runs[1]!.sameInputAsPrevious).toBe(true);
  captureNestingInput({ ...input, pieces: input.pieces.map(p => ({ ...p, id: 'new-id' })) });
  expect(session.runs[2]!.sameInputAsPrevious).toBe(false);
  expect(session.runs[2]!.sameGeometryAndOrderAsPrevious).toBe(true);
  captureNestingInput({ ...input, pieces: input.pieces.map(p => ({ ...p, allowedRotations: [180, 0] })) });
  expect(session.runs[3]!.sameGeometryAndOrderAsPrevious).toBe(false);
});

it('is opt-in and bounds retention independently of the input', () => {
  const session = enable();
  session.enabled = false;
  captureNestingInput(input);
  expect(session.runs).toHaveLength(0);
  session.enabled = true;
  for (let i = 0; i < 8; i++) captureNestingInput(input);
  expect(session.runs).toHaveLength(4);
  expect(session.runs.every(run => run.sameInputAsPrevious)).toBe(true);
});

it('posts the original object to the Worker after capture, without substituting references', async () => {
  const session = enable();
  const postMessage = vi.fn();
  class WorkerMock {
    onmessage?: (event: MessageEvent) => void;
    terminate = vi.fn();
    constructor() {
      expect(session.runs).toHaveLength(1);
    }
    postMessage(value: MultiNestingInput) {
      postMessage(value);
      this.onmessage?.({ data: { result: {
        layouts: [], unplacedPieceIds: [], placedCount: 0, totalPieceCount: 0,
      }, workerMs: 0 } } as MessageEvent);
    }
  }
  vi.stubGlobal('Worker', WorkerMock);
  await nestInWorker(input, new AbortController().signal);
  expect(postMessage.mock.calls[0]![0]).toBe(input);
  expect(postMessage.mock.calls[0]![0].pieces).toBe(input.pieces);
});
