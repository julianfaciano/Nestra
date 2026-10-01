import { expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  DEFAULT_CALANDRA_PROFILE,
  DEFAULT_IMPRENTA_2_PROFILE,
  nestingCanvasForProfile,
} from '../domain/canvas-profile';
import {
  nestMultiplePieces,
  type MultiNestingPiece,
} from './multi-piece-nesting-engine';
import { getPolygonBounds } from './polygon-transform';

const bench = process.env.NESTRA_LASER_BENCH === '1' ? it : it.skip;
bench(
  'compares the same 32 FRONT/BACK contours in Calandra and Imprenta 2',
  () => {
    const pieces: MultiNestingPiece[] = Array.from({ length: 32 }, (_, i) => ({
      id: `piece-${i}`,
      kind: 'garment',
      allowedRotations: i % 2 ? [0, 180] : [0, 90, 180, -90],
      polygon: Array.from({ length: 64 }, (_, j) => {
        const angle = (j * Math.PI) / 32,
          radius = 1 + 0.13 * Math.cos(angle * 5);
        return {
          x: 170 + 150 * radius * Math.cos(angle),
          y: 220 + 190 * radius * Math.sin(angle),
        };
      }),
    }));
    const runs = [DEFAULT_CALANDRA_PROFILE, DEFAULT_IMPRENTA_2_PROFILE].map(
      (profile) => {
        const input = {
          pieces: profile.laserCutOutline
            ? pieces.map((p) => ({
                ...p,
                cutComponents: [p.polygon],
                cutAnchor: p.polygon,
              }))
            : pieces,
          canvas: nestingCanvasForProfile(profile),
          scanStepMm: 10,
          diagnosticPhaseTiming: true,
        };
        nestMultiplePieces(input); // warm up
        const trials = Array.from({ length: 3 }, () =>
          nestMultiplePieces(input),
        );
        const result = trials[0]!,
          d = result.diagnostics!;
        expect(result.unplacedPieceIds).toEqual([]);
        return {
          profile: profile.name,
          requiredMs: trials
            .map((r) => r.diagnostics!.requiredMs)
            .sort((a, b) => a - b)[1],
          candidates: d.candidatePlacementsTested,
          broad: d.broadPhaseChecks,
          exact: d.exactPolygonCollisionChecks,
          layouts: result.layouts.length,
          usedHeight: result.layouts.map((l) => l.usedHeight),
          hash: createHash('sha256')
            .update(JSON.stringify(result.layouts))
            .digest('hex'),
          maxCutY: Math.max(
            ...result.layouts.flatMap((l) =>
              l.pieces.map(
                (p) =>
                  getPolygonBounds((p.cutComponents ?? [p.polygon]).flat())
                    .maxY,
              ),
            ),
          ),
        };
      },
    );
    console.log('IMPRENTA_2_BENCHMARK ' + JSON.stringify(runs));
    if (process.env.NESTRA_LASER_BENCH_OUTPUT)
      writeFileSync(
        process.env.NESTRA_LASER_BENCH_OUTPUT,
        JSON.stringify(runs, null, 2) + '\n',
      );
  },
  120_000,
);
