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
    }, (progress) => {
      self.postMessage({ progress });
    });

    const uiResult = {
      ...result,
      layouts: result.layouts.map(layout => ({
        ...layout,
        pieces: layout.pieces.map(({ collisionComponents, cutComponents, ...piece }) => {
          void collisionComponents;
          void cutComponents;
          return piece;
        }),
      })),
    };

    self.postMessage({
      result: uiResult,
      workerMs: performance.now() - startedAt,
    });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
      workerMs: performance.now() - startedAt,
    });
  }
};
