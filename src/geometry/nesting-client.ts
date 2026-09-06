import type {
  MultiNestingInput,
  MultiNestingResult,
} from './multi-piece-nesting-engine';
import { captureNestingInput } from './nesting-input-capture';

export interface NestingWorkerTiming {
  readonly roundTripMs: number;
  readonly workerMs: number;
  readonly overheadMs: number;
}

interface NestingWorkerResponse {
  readonly result?: MultiNestingResult;
  readonly error?: string;
  readonly workerMs?: number;
}

export function nestInWorker(
  input: MultiNestingInput,
  signal: AbortSignal,
  reportTiming?: (
    timing: NestingWorkerTiming,
  ) => void,
): Promise<MultiNestingResult> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(
        new Error('Optimización cancelada.'),
      );
      return;
    }

    captureNestingInput(input);
    const startedAt = performance.now();

    const worker = new Worker(
      new URL(
        './nesting-worker.ts',
        import.meta.url,
      ),
      {
        type: 'module',
      },
    );

    const cleanup = () => {
      worker.terminate();

      signal.removeEventListener(
        'abort',
        cancel,
      );
    };

    const cancel = () => {
      cleanup();

      reject(
        new Error('Optimización cancelada.'),
      );
    };

    signal.addEventListener(
      'abort',
      cancel,
      {
        once: true,
      },
    );

    worker.onmessage = (
      event: MessageEvent<NestingWorkerResponse>,
    ) => {
      const roundTripMs =
        performance.now() - startedAt;

      const workerMs =
        event.data.workerMs ?? roundTripMs;

      reportTiming?.({
        roundTripMs,
        workerMs,
        overheadMs: Math.max(
          0,
          roundTripMs - workerMs,
        ),
      });

      cleanup();

      if (event.data.result) {
        resolve(event.data.result);
        return;
      }

      reject(
        new Error(
          event.data.error ??
            'Respuesta del motor inválida.',
        ),
      );
    };

    worker.onerror = () => {
      cleanup();

      reject(
        new Error(
          'No se pudo ejecutar el motor en segundo plano.',
        ),
      );
    };

    worker.postMessage(input);
  });
}
