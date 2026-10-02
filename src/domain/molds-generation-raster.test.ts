import { describe, expect, it } from 'vitest';
import { CANONICAL_MOLD_GRADE_PIXELS, createMoldOutputPlan } from './molds-generation';
import {
  SIZE_MARK_CUT_ALPHA_THRESHOLD,
  SIZE_MARK_HEIGHT_PX,
  SIZE_MARK_MAX_DEPTH_SOURCE_PX,
  SIZE_MARK_RGB,
  createSizeMarkGlyph,
  findSizeMarkPlacement,
  normalizeSizeMarkGlyph,
  stampSizeMark,
  validateSizeMark,
  visibleSizeMarkBounds,
  type SizeMarkMask,
  type SizeMarkRaster,
} from './size-mark-raster';

const sampledDigits: Record<string, readonly string[]> = {
  '1': ['00110', '01110', '00110', '00110', '00110', '00110', '01111'],
};

function sampledNumber(scale = 8): SizeMarkMask {
  const source = sampledDigits['1']!;
  const width = source[0]!.length * scale + 18;
  const height = source.length * scale + 24;
  const data = new Uint8Array(width * height);
  for (const [y, row] of source.entries()) for (const [x, cell] of [...row].entries()) {
    if (cell !== '1') continue;
    for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
      data[(12 + y * scale + sy) * width + 9 + x * scale + sx] = sy === 0 || sx === 0 ? 1 : 255;
    }
  }
  return { width, height, data };
}

function image(width: number, height: number, alphaAt: (x: number, y: number) => number = () => 255): SizeMarkRaster {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 4;
    data.set([37, 63, 91, alphaAt(x, y)], offset);
  }
  return { width, height, data };
}

function assertDepthWithinLimit(raster: SizeMarkRaster, mask: SizeMarkMask, placement: { x: number; y: number }): void {
  for (let my = 0; my < mask.height; my++) for (let mx = 0; mx < mask.width; mx++) {
    if (!mask.data[my * mask.width + mx]) continue;
    const x = placement.x + mx;
    const y = placement.y + my;
    expect(raster.data[(y * raster.width + x) * 4 + 3]).toBeGreaterThan(SIZE_MARK_CUT_ALPHA_THRESHOLD);
    let edgeY = y;
    while (edgeY > 0 && raster.data[((edgeY - 1) * raster.width + x) * 4 + 3]! > SIZE_MARK_CUT_ALPHA_THRESHOLD) edgeY--;
    expect(y + 0.5 - edgeY).toBeLessThanOrEqual(SIZE_MARK_MAX_DEPTH_SOURCE_PX);
  }
}

describe('shared size mark raster', () => {
  it('creates each T1–T10 numeral at 18 visible source rows (6.35 mm at 72 PPI)', () => {
    expect(SIZE_MARK_HEIGHT_PX).toBe(18);
    for (let size = 1; size <= 10; size++) {
      const mask = createSizeMarkGlyph(`T${size}`);
      expect(visibleSizeMarkBounds(mask)).toEqual({ x: 0, y: 0, width: mask.width, height: 18 });
      expect([...mask.data].every(value => value === 0 || value === 255)).toBe(true);
      expect(mask.height * 25.4 / 72).toBeCloseTo(6.35, 6);
    }
    const sampled = normalizeSizeMarkGlyph(sampledNumber());
    expect(visibleSizeMarkBounds(sampled).height).toBe(18);
    expect(createSizeMarkGlyph('T10').width).toBeGreaterThan(createSizeMarkGlyph('T1').width);
    expect(() => createSizeMarkGlyph('T0')).toThrow(/1–10/);
  });

  it('stamps all 20 canonical outputs in lime without changing source alpha or pixels outside the glyph', () => {
    const plan = createMoldOutputPlan('TEST', {
      front: CANONICAL_MOLD_GRADE_PIXELS.front.T8,
      back: CANONICAL_MOLD_GRADE_PIXELS.back.T8,
    });
    expect(plan).toHaveLength(20);
    for (const spec of plan) {
      const mask = createSizeMarkGlyph(spec.size);
      const raster = image(160, 100, (x, y) => x >= 15 && x < 145 && y >= 15 && y < 85 ? 255 : 0);
      const before = raster.data.slice();
      const originalAlpha = new Uint8Array(raster.width * raster.height);
      for (let p = 0; p < originalAlpha.length; p++) originalAlpha[p] = before[p * 4 + 3]!;
      const placement = stampSizeMark(raster, mask);
      validateSizeMark(raster, originalAlpha, mask, placement);
      assertDepthWithinLimit({ ...raster, data: before }, mask, placement);
      let alphaDiff = 0;
      let outsideDiff = 0;
      let wrongGreen = 0;
      for (let p = 0; p < originalAlpha.length; p++) {
        const offset = p * 4;
        if (raster.data[offset + 3] !== before[offset + 3]) alphaDiff++;
        const x = p % raster.width;
        const y = Math.floor(p / raster.width);
        const mx = x - placement.x;
        const my = y - placement.y;
        const isInk = mx >= 0 && mx < mask.width && my >= 0 && my < mask.height && mask.data[my * mask.width + mx]! > 0;
        if (isInk) {
          if (raster.data[offset] !== 138 || raster.data[offset + 1] !== 255 || raster.data[offset + 2] !== 0) wrongGreen++;
        } else if (raster.data[offset] !== before[offset] || raster.data[offset + 1] !== before[offset + 1] ||
            raster.data[offset + 2] !== before[offset + 2]) outsideDiff++;
      }
      expect({ alphaDiff, outsideDiff, wrongGreen }).toEqual({ alphaDiff: 0, outsideDiff: 0, wrongGreen: 0 });
    }
    expect(SIZE_MARK_RGB).toEqual({ red: 138, green: 255, blue: 0 });
  });

  it('keeps the glyph at the highest centered position with no unnecessary gap', () => {
    const raster = image(120, 160, (x, y) => x >= 20 && x < 100 && y >= 10 && y < 110 ? 255 : 0);
    const mask = createSizeMarkGlyph('T1');
    const placement = findSizeMarkPlacement(raster, mask);
    expect(placement).toEqual({ x: 55, y: 10, width: mask.width, height: 18 });
    assertDepthWithinLimit(raster, mask, placement);
  });

  it('uses only a nearby horizontal fallback when the centered upper edge is obstructed', () => {
    const raster = image(100, 100, (x, y) => (x >= 20 && x < 80 && y >= 10 && y < 90) || (x === 50 && y === 10) ? 255 : 0);
    const mask = createSizeMarkGlyph('T1');
    const placement = findSizeMarkPlacement(raster, mask);
    expect(Math.abs(placement.x + mask.width / 2 - 50)).toBeLessThanOrEqual(10);
    expect(placement.y).toBe(10);
    assertDepthWithinLimit(raster, mask, placement);
  });

  it('rejects a centered neck placement if it would exceed the 6.5 mm inward depth', () => {
    const raster = image(160, 180, (x, y) => {
      if (y < 87) return (x >= 10 && x < 45) || (x >= 115 && x < 150) ? 255 : 0;
      if (y < 100) return x >= 70 && x < 90 ? 255 : 0;
      return x >= 12 && x < 148 ? 255 : 0;
    });
    expect(findSizeMarkPlacement(raster, createSizeMarkGlyph('T10')).y).toBeGreaterThanOrEqual(100);
  });

  it('rejects pixels outside cut alpha and preserves the raster when no safe placement exists', () => {
    for (const alpha of [0, 16]) {
      const raster = image(80, 80, () => alpha);
      const before = raster.data.slice();
      expect(() => stampSizeMark(raster, createSizeMarkGlyph('T1'))).toThrow(/alpha >16/);
      expect(raster.data).toEqual(before);
    }
    expect(() => normalizeSizeMarkGlyph({ width: 4, height: 4, data: new Uint8Array(16) })).toThrow(/no tiene píxeles/);
    expect(() => normalizeSizeMarkGlyph({ width: 4, height: 4, data: new Uint8Array(15) })).toThrow(/inválidos/);
  });
});
