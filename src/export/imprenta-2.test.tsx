import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import {
  DEFAULT_IMPRENTA_2_PROFILE,
  DEFAULT_CALANDRA_PROFILE,
  DEFAULT_IMPRENTA_PROFILE,
  CANVAS_PROFILES,
  IMPRENTA_2_MINIMUM_VISIBLE_GAP_MM,
  LASER_CUT_OUTLINE_WIDTH_MM,
  nominalSilhouetteClearanceMm,
  nestingCanvasForProfile,
} from '../domain/canvas-profile';
import { validateCanvasProfile } from '../domain/canvas-profile-validation';
import { mm } from '../domain/units';
import { preflightBatch, PX_PER_MM } from './export-plan';
import { nativePngPlan } from './native-png-export';
import { drawStrip } from './png-export';
import { BatchExportPanel } from '../app/batch-export-panel';
import { laserBatch } from '../test/imprenta-2-fixture';
import { rect } from '../test/fill-gaps-fixture';

describe('laser profile / preflight / shared output', () => {
  it('centralizes the third physical profile and round-trips its worker configuration', () => {
    expect(CANVAS_PROFILES.map((p) => p.name)).toEqual([
      'Calandra',
      'Imprenta',
      'Imprenta 2',
    ]);
    expect(DEFAULT_IMPRENTA_2_PROFILE).toMatchObject({
      id: 'imprenta-2',
      maxWidth: 1480,
      maxHeight: 5000,
      minimumVisibleGapMm: IMPRENTA_2_MINIMUM_VISIBLE_GAP_MM,
      laserCutOutline: true,
      laserCutOutlineWidthMm: LASER_CUT_OUTLINE_WIDTH_MM,
    });
    expect(validateCanvasProfile(DEFAULT_IMPRENTA_2_PROFILE)).toEqual([]);
    expect(LASER_CUT_OUTLINE_WIDTH_MM).toBe(3);
    expect(nominalSilhouetteClearanceMm(DEFAULT_IMPRENTA_2_PROFILE)).toBe(6);
    expect(
      validateCanvasProfile({
        ...DEFAULT_IMPRENTA_2_PROFILE,
        maxHeight: mm(5001),
      }),
    ).not.toEqual([]);
    const canvas = nestingCanvasForProfile(DEFAULT_IMPRENTA_2_PROFILE);
    expect(JSON.parse(JSON.stringify(canvas))).toEqual(canvas);
    expect(canvas.minimumPieceClearance).toBe(6);
    expect(canvas.outlineExtentMm).toBe(1.5);
  });
  it.each([
    [2.999, true],
    [3, false],
    [3.001, false],
  ] as const)('preflight %s mm: invalid=%s', (gap, invalid) => {
    const report = preflightBatch(laserBatch(gap));
    expect(report.errors.some((e) => e.includes('requiere 3,0 mm visibles'))).toBe(
      invalid,
    );
    if (!invalid) expect(report.errors).toEqual([]);
    else expect(report.errors.join(' ')).toContain('Canvas 1');
  });
  it.each([DEFAULT_CALANDRA_PROFILE, DEFAULT_IMPRENTA_PROFILE])(
    'retains touching and no outline for $name',
    (profile) => {
      const report = preflightBatch(laserBatch(0, profile));
      expect(report.errors).toEqual([]);
      expect(report.layouts[0]!.laserOutline).toBeUndefined();
      expect(
        nativePngPlan(report.layouts[0]!, new Map([['cut', 0]])).laserOutline,
      ).toBeUndefined();
    },
  );
  it('reports real collision, missing required and stroke beyond physical edges', () => {
    expect(preflightBatch(laserBatch(-4)).errors.join(' ')).toContain(
      'colisión',
    );
    const batch = laserBatch();
    const layout = batch.results[0]!.layouts[0]!;
    const missing = {
      ...batch,
      results: [
        {
          ...batch.results[0]!,
          layouts: [{ ...layout, pieces: layout.pieces.slice(0, 1) }],
        },
      ],
    };
    expect(preflightBatch(missing).errors.join(' ')).toContain(
      'Falta pieza solicitada',
    );
    const edge = {
      ...batch,
      results: [
        {
          ...batch.results[0]!,
          layouts: [
            {
              ...layout,
              pieces: layout.pieces.map((p, i) =>
                i ? p : { ...p, placement: { ...p.placement, x: 0 } },
              ),
            },
          ],
        },
      ],
    };
    expect(preflightBatch(edge).errors.join(' ')).toContain(
      'contorno láser fuera',
    );
  });
  it('envelopes the full stroke in the raster crop with fixed width and unchanged source placement', () => {
    const layout = preflightBatch(laserBatch()).layouts[0]!;
    expect(layout.widthMm).toBe(1480);
    expect(layout.offsetY).toBeCloseTo(0, 10);
    expect(layout.heightMm).toBeCloseTo(23, 10);
    expect(layout.heightPx / PX_PER_MM).toBeGreaterThanOrEqual(layout.heightMm);
    const plan = nativePngPlan(layout, new Map([['cut', 7]]));
    expect(plan.laserOutline!.width).toBeCloseTo(3 * PX_PER_MM, 10);
    expect(plan.laserOutline!.contours).toHaveLength(2);
    expect(plan.pieces[0]).toMatchObject({
      source: 7,
      translateX: 1.5 * PX_PER_MM,
      translateY: 1.5 * PX_PER_MM,
      rotation: 0,
    });
    for (const contour of plan.laserOutline!.contours)
      for (const [x, y] of contour) {
        expect(x! - plan.laserOutline!.width / 2).toBeGreaterThanOrEqual(-1e-9);
        expect(y! - plan.laserOutline!.width / 2).toBeGreaterThanOrEqual(-1e-9);
        expect(x! + plan.laserOutline!.width / 2).toBeLessThanOrEqual(
          plan.width + 1e-9,
        );
        expect(y! + plan.laserOutline!.width / 2).toBeLessThanOrEqual(
          plan.height + 1e-9,
        );
      }
  });
  it('renders the same non-rectangular contours in the preview and strip PNG', () => {
    const triangle = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 0, y: 20 },
    ];
    const batch = {
      ...laserBatch(),
      cutComponents: new Map([['cut', [triangle]]]),
    };
    const report = preflightBatch(batch);
    expect(report.errors).toEqual([]);
    const context = {
      resetTransform: vi.fn(),
      fillRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      drawImage: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      stroke: vi.fn(),
      strokeStyle: '',
      lineWidth: 0,
      lineJoin: '',
      lineCap: '',
    };
    drawStrip(
      context as unknown as CanvasRenderingContext2D,
      report.layouts[0]!,
      new Map([['cut', {} as CanvasImageSource]]),
      64,
      64,
    );
    expect(context.stroke).toHaveBeenCalledTimes(2);
    expect(context.lineTo).toHaveBeenCalledTimes(4);
    expect(context.strokeStyle).toBe('#000000');
    expect(context.lineWidth).toBe(3 * PX_PER_MM);
    expect(context.drawImage.mock.invocationCallOrder[1]).toBeLessThan(
      context.stroke.mock.invocationCallOrder[0]!,
    );
    const view = render(
      <BatchExportPanel
        report={report}
        onExport={() => {}}
        onCancel={() => {}}
        busy={false}
        exporting={false}
        exported={false}
        status={null}
      />,
    );
    const polygons = view.container.querySelectorAll('svg polygon');
    expect(polygons.length).toBeGreaterThanOrEqual(2);
    expect(polygons[0]!.getAttribute('points')).toBe(
      report.layouts[0]!.pieces[0]!.cutComponents![0]!.map(
        (v) => `${v.x},${v.y}`,
      ).join(' '),
    );
    expect(polygons[0]!.getAttribute('stroke')).toBe('#000000');
    expect(polygons[0]!.getAttribute('stroke-width')).toBe('3');
  });
  it('draws each personalized exterior island instead of the conservative rectangle', () => {
    const batch = laserBatch(40);
    const definition = {
      ...batch.definitions[0]!,
      kind: 'replacement-piece' as const,
      model: 'Argentina 2026 nom BENJI',
      size: 'T8' as const,
      side: 'back' as const,
      collectionId: 'argentina',
    };
    const cut = [
      rect(10, 10),
      rect(3, 3).map((v) => ({ x: v.x + 15, y: v.y + 15 })),
    ];
    const report = preflightBatch({
      ...batch,
      definitions: [definition],
      cutComponents: new Map([['cut', cut]]),
    });
    expect(report.errors).toEqual([]);
    expect(
      nativePngPlan(report.layouts[0]!, new Map([['cut', 0]])).laserOutline!
        .contours,
    ).toHaveLength(4);
  });
});
