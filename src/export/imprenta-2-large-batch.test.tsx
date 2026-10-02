import { expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { writeFileSync } from 'node:fs';
import { parseOrderText } from '../domain/order-import';
import { expandPieceDefinitions } from '../domain/piece-instance';
import type { GarmentPieceDefinition } from '../domain/production-batch';
import { getAllowedRotationsForPiece } from '../domain/piece-rotation';
import { mm } from '../domain/units';
import { PRODUCTION_ORDER } from '../test/production-order-2026-10-01';
import { DEFAULT_IMPRENTA_2_PROFILE, nestingCanvasForProfile } from '../domain/canvas-profile';
import { certifyPreparedBatchGeometry, preflightBatchCooperatively, type PreparedBatch } from './export-plan';
import { BatchExportPanel } from '../app/batch-export-panel';
import { nestMultiplePieces } from '../geometry/multi-piece-nesting-engine';

const rect = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 20 },
  { x: 0, y: 20 },
];

it('completes the 641-garment / 1282-piece Imprenta 2 UI preflight cooperatively', async () => {
  const names = PRODUCTION_ORDER.split(';').map(raw => raw.trim().match(/^(.*?)\s+T\d+=/i)?.[1]?.trim()).filter((name): name is string => Boolean(name));
  const designs = names.map((name, index) => ({ id: `design-${index}`, name }));
  const order = parseOrderText(PRODUCTION_ORDER, designs);
  expect(order.errors).toEqual([]);
  expect(order.totalGarments).toBe(641);
  expect(order.totalPieces).toBe(1282);

  const definitions: GarmentPieceDefinition[] = order.lines.flatMap(line =>
    Object.entries(line.quantities).flatMap(([size, quantity]) => quantity > 0
      ? (['front', 'back'] as const).map(side => ({
          kind: 'garment' as const,
          id: `${line.collectionId}-${size}-${side}`,
          model: line.designName,
          size: size as GarmentPieceDefinition['size'],
          side,
          fabric: 'polar',
          quantity,
          fileName: `${line.collectionId}-${size}-${side}.png`,
          imageUrl: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 20 20%22/%3E',
          sourceWidthPx: 100,
          sourceHeightPx: 100,
          physicalWidthMm: mm(20),
          physicalHeightMm: mm(20),
          alphaThreshold: 16,
          simplificationTolerancePx: 1.5,
        }))
      : []),
  );
  expect(definitions).toHaveLength(372);

  const instances = expandPieceDefinitions(definitions);
  expect(instances).toHaveLength(1282);
  const nested = nestMultiplePieces({
    pieces: instances.map(instance => ({
      id: instance.id,
      polygon: rect,
      cutComponents: [rect],
      cutAnchor: rect,
      allowedRotations: getAllowedRotationsForPiece(instance.definition),
    })),
    canvas: nestingCanvasForProfile(DEFAULT_IMPRENTA_2_PROFILE),
    scanStepMm: 10,
    searchStrategy: 'fast',
    diagnosticPhaseTiming: true,
  });
  expect(nested.placedCount).toBe(1282);
  expect(nested.unplacedPieceIds).toEqual([]);
  expect(nested.diagnostics?.fastChunkRuns?.map(chunk => chunk.pieceCount)).toEqual([150, 150, 150, 150, 150, 150, 150, 150, 82]);

  const polygons = new Map(definitions.map(definition => [definition.id, rect]));
  const batch: PreparedBatch = {
    profile: DEFAULT_IMPRENTA_2_PROFILE,
    definitions,
    polygons,
    collisionPolygons: polygons,
    cutComponents: new Map(definitions.map(definition => [definition.id, [rect]])),
    sourceAlphaBounds: new Map(definitions.map(definition => [definition.id, { x: 0, y: 0, width: 100, height: 100 }])),
    sourcePlacementBounds: new Map(definitions.map(definition => [definition.id, { x: 0, y: 0, width: 100, height: 100 }])),
    results: [{ fabric: 'polar', elapsedMs: nested.diagnostics?.requiredMs ?? 0, unplacedPieceIds: nested.unplacedPieceIds, layouts: nested.layouts }],
  };
  certifyPreparedBatchGeometry(batch);

  const observedProgress: { phase: string; completedPlacements: number; totalPlacements: number }[] = [];
  const controller = new AbortController();
  const preflight = await preflightBatchCooperatively(batch, controller.signal, progress => observedProgress.push(progress));
  expect(preflight.report.errors).toEqual([]);
  expect(preflight.report.diagnostics?.geometryAlreadyChecked).toBe(true);
  expect(preflight.report.layouts.flatMap(layout => layout.pieces)).toHaveLength(1282);
  expect(preflight.report.layouts.every(layout => layout.widthMm === 1560 && layout.heightMm <= 5000)).toBe(true);
  expect(observedProgress.some(progress => progress.phase === 'validation' && progress.completedPlacements === 1282)).toBe(true);
  expect(observedProgress.some(progress => progress.phase === 'consolidation' && progress.completedPlacements === 1282)).toBe(true);
  expect(preflight.yieldCount).toBeGreaterThan(0);

  const view = render(
    <BatchExportPanel
      report={preflight.report}
      onExport={() => {}}
      onCancel={() => {}}
      busy={false}
      exporting={false}
      exported={false}
      status={null}
    />,
  );
  expect(view.container.textContent).toContain(`Exportar ${preflight.report.layouts.length}`);
  expect(view.container.querySelectorAll('.batch-export-layout')).toHaveLength(preflight.report.layouts.length);
  expect(view.container.querySelector('select[aria-label="Canvas a previsualizar"]')).toBeNull();
  expect(view.container.querySelectorAll('figcaption.batch-export-caption')).toHaveLength(preflight.report.layouts.length);
  const uiMetrics = {
    dataset: 'Synthetic UI regression; production fixture counts and fast chunking',
    totalPieces: 1282,
    logicalPieceTypes: definitions.length,
    uniqueRealGeometries: 'not applicable to synthetic rectangles',
    internalCanvases: preflight.report.diagnostics?.internalCanvasCount,
    finalCanvases: preflight.report.diagnostics?.packedCanvasCount,
    preflightElapsedMs: preflight.elapsedMs,
    preflightMaxMainThreadTaskMs: preflight.maxMainThreadTaskMs,
    preflightYieldCount: preflight.yieldCount,
    finalLayoutsInVerticalList: view.container.querySelectorAll('.batch-export-layout').length,
    previewSelectorPresent: Boolean(view.container.querySelector('select[aria-label="Canvas a previsualizar"]')),
    previewsRenderedInitially: view.container.querySelectorAll('svg.batch-export-artwork').length,
  };
  if (process.env.NESTRA_UI_PREFLIGHT_OUTPUT) {
    writeFileSync(process.env.NESTRA_UI_PREFLIGHT_OUTPUT, `${JSON.stringify(uiMetrics, null, 2)}\n`);
  }
}, 20_000);
