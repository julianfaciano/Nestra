import type { MultiNestingInput } from './multi-piece-nesting-engine';

interface CapturedInput {
  readonly json: string;
  readonly sameInputAsPrevious: boolean | null;
  readonly sameGeometryAndOrderAsPrevious: boolean | null;
}

interface CaptureSession {
  enabled: boolean;
  runs: CapturedInput[];
  error?: string;
}

type CaptureGlobal = typeof globalThis & {
  __nestraNestingCapture?: CaptureSession;
};

function geometryAndOrder(json: string): string {
  const input = JSON.parse(json) as MultiNestingInput;
  return JSON.stringify({
    canvas: input.canvas,
    scanStepMm: input.scanStepMm ?? 10,
    pieces: input.pieces.map(piece => ({
      polygon: piece.polygon,
      allowedRotations: piece.allowedRotations,
    })),
  });
}

/** Temporary opt-in capture, outside the Worker and its measured round trip.
 * Retains strings only; never substitutes or mutates the posted input.
 */
export function captureNestingInput(input: MultiNestingInput): void {
  const session = (globalThis as CaptureGlobal).__nestraNestingCapture;
  if (!session?.enabled) return;
  try {
    const json = JSON.stringify(input, (_key, value: unknown) => {
      if (typeof value === 'number' && !Number.isFinite(value)) {
        throw new Error('No se puede capturar un input con números no finitos.');
      }
      return value;
    });
    const previous = session.runs.at(-1);
    session.runs.push({
      json,
      sameInputAsPrevious: previous ? json === previous.json : null,
      sameGeometryAndOrderAsPrevious: previous
        ? geometryAndOrder(json) === geometryAndOrder(previous.json)
        : null,
    });
    // Bounded diagnostic retention, not a cache used by the engine.
    if (session.runs.length > 4) session.runs.shift();
    delete session.error;
  } catch (error) {
    session.error = error instanceof Error ? error.message : String(error);
  }
}
