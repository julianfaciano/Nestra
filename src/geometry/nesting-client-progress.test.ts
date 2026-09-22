import { afterEach, expect, it, vi } from 'vitest';
import { nestInWorker } from './nesting-client';
import type { MultiNestingInput } from './multi-piece-nesting-engine';

afterEach(() => vi.unstubAllGlobals());

const input: MultiNestingInput = {
  canvas: { width: 10, height: 10 },
  pieces: [],
};

it('forwards progress without settling the worker and cancellation still terminates it', async () => {
  const terminate = vi.fn();
  const progress = vi.fn();

  class WorkerMock {
    onmessage?: (event: MessageEvent) => void;
    onerror?: () => void;
    terminate = terminate;

    postMessage() {
      this.onmessage?.({
        data: {
          progress: { phase: 'required', completed: 1, total: 2 },
        },
      } as MessageEvent);
    }
  }

  vi.stubGlobal('Worker', WorkerMock);
  const controller = new AbortController();
  const promise = nestInWorker(input, controller.signal, undefined, progress);

  expect(progress).toHaveBeenCalledWith({
    phase: 'required',
    completed: 1,
    total: 2,
  });
  controller.abort();

  await expect(promise).rejects.toThrow('Optimización cancelada.');
  expect(terminate).toHaveBeenCalledOnce();
});
