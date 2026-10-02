import { describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import {
  DEFAULT_IMPRENTA_2_PROFILE,
  DEFAULT_CALANDRA_PROFILE,
  DEFAULT_IMPRENTA_PROFILE,
  CANVAS_PROFILES,
  IMPRENTA_2_MINIMUM_VISIBLE_GAP_MM,
  LASER_CUT_OUTLINE_WIDTH_MM,
  nominalSilhouetteClearanceMm,
  nestingCanvasForProfile,
  outlineExtentMm,
} from '../domain/canvas-profile';
import { validateCanvasProfile } from '../domain/canvas-profile-validation';
import { mm } from '../domain/units';
import { consolidateImprenta2ExportLayouts, preflightBatch, PX_PER_MM } from './export-plan';
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
      maxWidth: 1560,
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
  it('reserves the consolidation margins in Imprenta 2 nesting height', () => {
    const profile = DEFAULT_IMPRENTA_2_PROFILE;
    const canvas = nestingCanvasForProfile(profile);
    const rasterSafeHeight = Math.floor(profile.maxHeight * PX_PER_MM) / PX_PER_MM;
    const exteriorMargin = outlineExtentMm(profile);

    expect(canvas.height).toBeCloseTo(rasterSafeHeight - 2 * exteriorMargin, 10);
    expect(canvas.minimumPieceClearance).toBe(6);
    expect(canvas.outlineExtentMm).toBe(1.5);
    expect(nestingCanvasForProfile(DEFAULT_CALANDRA_PROFILE).height).toBe(5000);
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
    expect(layout.widthMm).toBe(1560);
    expect(layout.offsetY).toBeCloseTo(0, 10);
    expect(layout.heightMm).toBeCloseTo(26, 10);
    expect(layout.heightPx / PX_PER_MM).toBeGreaterThanOrEqual(layout.heightMm);
    const plan = nativePngPlan(layout, new Map([['cut', 7]]));
    expect(plan.pageWidthMm).toBe(1560);
    expect(plan.pageHeightMm).toBe(layout.heightMm);
    expect(plan.width).toBe(18425);
    expect(plan.laserOutline!.width).toBeCloseTo(3 * PX_PER_MM, 10);
    expect(plan.laserOutline!.contours).toHaveLength(2);
    expect(plan.pieces[0]).toMatchObject({
      source: 7,
      translateX: 1.5 * PX_PER_MM,
      translateY: 3 * PX_PER_MM,
      rotation: 0,
    });
    for (const contour of plan.laserOutline!.contours)
      for (const [x, y] of contour) {
        expect(x! - plan.laserOutline!.width / 2).toBeGreaterThanOrEqual(-1e-9);
        expect(y! - plan.laserOutline!.width / 2).toBeGreaterThanOrEqual(1.5 * PX_PER_MM - 1e-9);
        expect(x! + plan.laserOutline!.width / 2).toBeLessThanOrEqual(
          plan.width + 1e-9,
        );
        expect(y! + plan.laserOutline!.width / 2).toBeLessThanOrEqual(
          plan.height - 1.5 * PX_PER_MM + 1e-9,
        );
      }
  });
  it('consolidates internal canvases with exact visible gap and exterior stroke margin', () => {
    const packed = preflightBatch(laserBatch()).layouts[0]!;
    const toInternalStrip = (pieceIndex: number, fabric = packed.fabric, offsetX = 0) => ({
      ...packed,
      name: `${packed.name}-${pieceIndex}`,
      fabric,
      offsetX,
      heightMm: 23,
      heightPx: Math.ceil(23 * PX_PER_MM),
      offsetY: 0,
      pieces: [packed.pieces[pieceIndex]!].map(art => ({
        ...art,
        placement: { ...art.placement, y: art.placement.y - 1.5 },
        translateY: art.translateY - 1.5,
        ...(art.cutComponents ? { cutComponents: art.cutComponents.map(contour =>
          contour.map(point => ({ ...point, y: point.y - 1.5 }))) } : {}),
      })),
    });
    const strips = [toInternalStrip(0), toInternalStrip(1, packed.fabric, 2)];
    const result = consolidateImprenta2ExportLayouts(strips, DEFAULT_IMPRENTA_2_PROFILE);
    expect(result.packedCanvasCount).toBe(1);
    expect(result.layouts[0]?.pieces).toHaveLength(2);
    expect(result.layouts[0]?.offsetX).toBe(0);
    expect(result.layouts[0]?.pieces[1]?.placement.x).toBe(strips[1]!.pieces[0]!.placement.x);
    expect(result.layouts[0]?.pieces[1]?.translateX).toBeCloseTo(strips[1]!.pieces[0]!.translateX - 2, 10);
    expect(result.layouts[0]?.heightMm).toBeCloseTo(52, 10);
    const bounds = result.layouts[0]!.pieces.map(art => {
      const ys = art.cutComponents!.flatMap(contour => contour.map(point => point.y));
      return { min: Math.min(...ys), max: Math.max(...ys) };
    }).sort((first, second) => first.min - second.min);
    expect(bounds[0]!.min - 1.5).toBeCloseTo(1.5, 10);
    expect(bounds[1]!.min - bounds[0]!.max).toBeCloseTo(6, 10);
    expect(result.layouts[0]!.heightMm - (bounds[1]!.max + 1.5)).toBeCloseTo(1.5, 10);

    const separateFabrics = consolidateImprenta2ExportLayouts(
      [strips[0]!, toInternalStrip(1, `${packed.fabric} alternativo`, 2)],
      DEFAULT_IMPRENTA_2_PROFILE,
    );
    expect(separateFabrics.packedCanvasCount).toBe(2);
    expect(new Set(separateFabrics.layouts.map(layout => layout.fabric))).toEqual(new Set([packed.fabric, `${packed.fabric} alternativo`]));
  });
  it('accepts the maximum nestable strip with both 1.5 mm exterior margins', () => {
    const profile = DEFAULT_IMPRENTA_2_PROFILE;
    const rasterSafeHeight = Math.floor(profile.maxHeight * PX_PER_MM) / PX_PER_MM;
    const stripLimit = rasterSafeHeight - 2 * outlineExtentMm(profile);
    const packed = preflightBatch(laserBatch()).layouts[0]!;
    const strip = {
      ...packed,
      heightMm: stripLimit,
      heightPx: Math.ceil(stripLimit * PX_PER_MM),
    };

    const consolidated = consolidateImprenta2ExportLayouts([strip], profile);

    expect(consolidated.layouts[0]!.heightMm).toBeCloseTo(rasterSafeHeight, 10);
    expect(consolidated.layouts[0]!.heightPx).toBe(Math.floor(profile.maxHeight * PX_PER_MM));
  });
  it('renders the same non-rectangular contours in the preview and strip PNG', async () => {
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
    expect((context as typeof context & { globalAlpha: number }).globalAlpha).toBe(1);
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
    await waitFor(() => expect(view.container.querySelectorAll('svg polygon').length).toBeGreaterThanOrEqual(2));
    const polygons = view.container.querySelectorAll('svg polygon');
    expect(polygons[0]!.getAttribute('points')).toBe(
      report.layouts[0]!.pieces[0]!.cutComponents![0]!.map(
        (v) => `${v.x},${v.y}`,
      ).join(' '),
    );
    expect(polygons[0]!.getAttribute('stroke')).toBe('#000000');
    expect(polygons[0]!.getAttribute('stroke-width')).toBe('3');
  });
  it.each(['left', 'right', 'top', 'bottom'] as const)('rejects 0.001 mm of stroke clipping on the %s canvas edge', edge => {
    const batch = laserBatch();
    const canvas = nestingCanvasForProfile(batch.profile);
    const original = batch.results[0]!.layouts[0]!;
    function atEdge(overflow: number) {
      const placement = {
        x: edge === 'right' ? canvas.width - 20 - 1.5 + overflow : 1.5 - (edge === 'left' ? overflow : 0),
        y: edge === 'bottom' ? batch.profile.maxHeight - 20 - 1.5 + overflow : 1.5 - (edge === 'top' ? overflow : 0),
        rotation: 0 as const,
      };
      return preflightBatch({ ...batch, results: [{ ...batch.results[0]!, layouts: [{ ...original, pieces: [
        { ...original.pieces[0]!, placement },
        { ...original.pieces[1]!, placement: { x: 100, y: 100, rotation: 0 as const } },
      ] }] }] });
    }
    expect(atEdge(0).errors).toEqual([]);
    expect(atEdge(0.001).errors.length).toBeGreaterThan(0);
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
