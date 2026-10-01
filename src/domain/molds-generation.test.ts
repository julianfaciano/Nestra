import { describe, expect, it } from 'vitest';
import { parseDesignAssetFilename } from './design-asset-filename';
import {
  CANONICAL_MOLD_GRADE_PIXELS,
  canonicalMoldAxisScale,
  createMoldOutputPlan,
  validateMoldPrefix,
} from './molds-generation';
import { GARMENT_SIZES } from './size';

const canonicalMasters = {
  front: CANONICAL_MOLD_GRADE_PIXELS.front.T8,
  back: CANONICAL_MOLD_GRADE_PIXELS.back.T8,
};

describe('Moldes generation plan', () => {
  it('plans T1–T10 FRONT/BACK from only the two T8 masters and matches the canonical grade pixels', () => {
    const plan = createMoldOutputPlan('BOCA26', canonicalMasters);
    expect(plan).toHaveLength(20);
    expect(plan[0]).toMatchObject({ size: 'T1', side: 'front', sourceSide: 'front', fileName: 'BOCA26_0000_T1-FRENTE.png', widthPx: 463, heightPx: 577 });
    expect(plan[1]).toMatchObject({ size: 'T1', side: 'back', sourceSide: 'back', fileName: 'BOCA26_0001_T1-DORSO.png', widthPx: 521, heightPx: 753 });
    expect(plan[14]).toMatchObject({ size: 'T8', side: 'front', fileName: 'BOCA26_0014_T8-FRENTE.png', widthPx: 985, heightPx: 1226 });
    expect(plan[19]).toMatchObject({ size: 'T10', side: 'back', fileName: 'BOCA26_0019_T10-DORSO.png', widthPx: 1451, heightPx: 2052 });

    for (const [index, size] of GARMENT_SIZES.entries()) {
      for (const [sideIndex, side] of (['front', 'back'] as const).entries()) {
        const item = plan[index * 2 + sideIndex]!;
        expect(item).toMatchObject({
          size,
          side,
          widthPx: CANONICAL_MOLD_GRADE_PIXELS[side][size].widthPx,
          heightPx: CANONICAL_MOLD_GRADE_PIXELS[side][size].heightPx,
        });
        expect(parseDesignAssetFilename(item.fileName)).toMatchObject({ size, side });
      }
    }
  });

  it('applies the measured independent X/Y grade for BACK T9/T10', () => {
    const t9 = canonicalMoldAxisScale('T9', 'back');
    const t10 = canonicalMoldAxisScale('T10', 'back');
    expect(t9.scaleX).toBeCloseTo(1.08514, 5);
    expect(t9.scaleY).toBeCloseTo(1.07274, 5);
    expect(t10.scaleX).toBeCloseTo(1.16546, 5);
    expect(t10.scaleY).toBeCloseTo(1.13937, 5);
    expect(t9.scaleX).not.toBe(t9.scaleY);
    expect(t10.scaleX).not.toBe(t10.scaleY);
  });

  it('uses the selected T8 master dimensions for a collection that has no destination sizes', () => {
    const plan = createMoldOutputPlan('INCOMPLETA', {
      front: { widthPx: 978, heightPx: 1224 },
      back: { widthPx: 1245, heightPx: 1796 },
    });
    expect(plan).toHaveLength(20);
    expect(plan.find(item => item.size === 'T6' && item.side === 'front')).toMatchObject({ widthPx: 829, heightPx: 1040 });
    expect(plan.find(item => item.size === 'T10' && item.side === 'back')).toMatchObject({ widthPx: 1451, heightPx: 2046 });
    expect(plan.every(item => item.physicalWidthMm > 0 && item.physicalHeightMm > 0)).toBe(true);
  });

  it('rejects unsafe and nom-containing prefixes and raster dimensions above the memory limit', () => {
    expect(validateMoldPrefix('BOCA 26')).toMatch(/sin espacios/);
    expect(validateMoldPrefix('nom-Boca')).toMatch(/nom/);
    expect(validateMoldPrefix('BOCA26')).toBeUndefined();
    expect(() => createMoldOutputPlan('TEST', {
      front: { widthPx: 5000, heightPx: 5000 }, back: { widthPx: 100, heightPx: 100 },
    })).toThrow(/límite seguro/);
  });
});
