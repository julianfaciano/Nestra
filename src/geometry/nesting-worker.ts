import {
  nestMultiplePieces,
  type MultiNestingInput,
} from './multi-piece-nesting-engine';

self.onmessage = (event: MessageEvent<MultiNestingInput>) => {
  const startedAt = performance.now();

  try {
    const result = nestMultiplePieces({
  ...event.data,
  diagnosticProfiling: event.data.diagnosticProfiling ?? false,
});

    self.postMessage({
      result,
      workerMs: performance.now() - startedAt,
    });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
      workerMs: performance.now() - startedAt,
    });
  }
};
