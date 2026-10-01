import { parseDesignAssetFilename } from './design-asset-filename';
import type { PieceSide } from './piece-side';
import { GARMENT_SIZES, type GarmentSize } from './size';
import { millimetersFromSourcePixels } from './source-image-size';

export interface MoldMasterPixels {
  readonly widthPx: number;
  readonly heightPx: number;
}

export interface MoldReferencePixels extends MoldMasterPixels {}

export interface MoldAxisScale {
  readonly scaleX: number;
  readonly scaleY: number;
}

export interface MoldOutputSpec extends MoldAxisScale {
  readonly size: GarmentSize;
  readonly side: PieceSide;
  readonly sourceSide: PieceSide;
  readonly fileName: string;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly physicalWidthMm: number;
  readonly physicalHeightMm: number;
}

/**
 * Canonical raster grade measured from the modal dimensions of 49 complete,
 * unique T1–T10 collections in the user's existing .fanaticotas library.
 * Ratios are relative to T8 for the same side. The separate X/Y dimensions
 * preserve the observed BACK T9/T10 grade; they are not silhouette padding.
 */
export const CANONICAL_MOLD_GRADE_PIXELS = {
  front: {
    T1: { widthPx: 463, heightPx: 577 },
    T2: { widthPx: 534, heightPx: 665 },
    T3: { widthPx: 616, heightPx: 766 },
    T4: { widthPx: 697, heightPx: 867 },
    T5: { widthPx: 766, heightPx: 953 },
    T6: { widthPx: 835, heightPx: 1042 },
    T7: { widthPx: 906, heightPx: 1127 },
    T8: { widthPx: 985, heightPx: 1226 },
    T9: { widthPx: 1076, heightPx: 1339 },
    T10: { widthPx: 1159, heightPx: 1442 },
  },
  back: {
    T1: { widthPx: 521, heightPx: 753 },
    T2: { widthPx: 633, heightPx: 915 },
    T3: { widthPx: 720, heightPx: 1041 },
    T4: { widthPx: 832, heightPx: 1204 },
    T5: { widthPx: 953, heightPx: 1379 },
    T6: { widthPx: 1049, heightPx: 1517 },
    T7: { widthPx: 1147, heightPx: 1660 },
    T8: { widthPx: 1245, heightPx: 1801 },
    T9: { widthPx: 1351, heightPx: 1932 },
    T10: { widthPx: 1451, heightPx: 2052 },
  },
} as const satisfies Record<PieceSide, Record<GarmentSize, MoldReferencePixels>>;

export function validateMoldPrefix(prefix: string): string | undefined {
  const normalized = prefix.trim();
  if (!normalized) return 'Ingresá un prefijo/código para los archivos.';
  if (normalized.length > 32 || !/^[a-z0-9._-]+$/i.test(normalized)) {
    return 'Usá hasta 32 letras, números, puntos, guiones o guiones bajos; sin espacios ni rutas.';
  }
  if (/nom/i.test(normalized)) return 'El prefijo no puede contener "nom": Biblioteca lo interpreta como dorsal personalizado.';
  return undefined;
}

export function canonicalMoldAxisScale(size: GarmentSize, side: PieceSide): MoldAxisScale {
  const base = CANONICAL_MOLD_GRADE_PIXELS[side].T8;
  const target = CANONICAL_MOLD_GRADE_PIXELS[side][size];
  return {
    scaleX: target.widthPx / base.widthPx,
    scaleY: target.heightPx / base.heightPx,
  };
}

export function createMoldOutputPlan(
  prefix: string,
  masters: Readonly<Record<PieceSide, MoldMasterPixels>>,
): MoldOutputSpec[] {
  const prefixError = validateMoldPrefix(prefix);
  if (prefixError) throw new Error(prefixError);

  for (const side of ['front', 'back'] as const) {
    const master = masters[side];
    if (!Number.isSafeInteger(master.widthPx) || !Number.isSafeInteger(master.heightPx) ||
        master.widthPx <= 0 || master.heightPx <= 0 || master.widthPx * master.heightPx > 16_000_000) {
      throw new Error(`El master de ${side === 'front' ? 'Frente' : 'Dorso'} supera el límite seguro de resolución.`);
    }
  }

  return GARMENT_SIZES.flatMap((size, sizeIndex) => (['front', 'back'] as const).map(side => {
    const { scaleX, scaleY } = canonicalMoldAxisScale(size, side);
    const master = masters[side];
    const widthPx = Math.max(1, Math.round(master.widthPx * scaleX));
    const heightPx = Math.max(1, Math.round(master.heightPx * scaleY));
    if (!Number.isSafeInteger(widthPx) || !Number.isSafeInteger(heightPx) ||
        widthPx * heightPx > 16_000_000 || widthPx > 32_000 || heightPx > 32_000) {
      throw new Error(`${size} ${side === 'front' ? 'Frente' : 'Dorso'} supera el límite seguro de resolución.`);
    }
    const sequence = String(sizeIndex * 2 + (side === 'back' ? 1 : 0)).padStart(4, '0');
    const sideName = side === 'front' ? 'FRENTE' : 'DORSO';
    const fileName = `${prefix.trim()}_${sequence}_${size}-${sideName}.png`;
    const parsed = parseDesignAssetFilename(fileName);
    if (!parsed || parsed.size !== size || parsed.side !== side) {
      throw new Error(`El nombre generado no es compatible con Biblioteca: ${fileName}`);
    }
    return {
      size,
      side,
      sourceSide: side,
      fileName,
      widthPx,
      heightPx,
      physicalWidthMm: millimetersFromSourcePixels(widthPx),
      physicalHeightMm: millimetersFromSourcePixels(heightPx),
      scaleX,
      scaleY,
    };
  }));
}
