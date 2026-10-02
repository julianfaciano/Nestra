import { extractAlphaComponents } from '../geometry/alpha-polygon';

const SOURCE_IMAGE_PPI = 72;
const MILLIMETERS_PER_INCH = 25.4;
export const SIZE_MARK_CUT_ALPHA_THRESHOLD = 16;
export const SIZE_MARK_MAX_DEPTH_MM = 6.5;
export const SIZE_MARK_MAX_DEPTH_SOURCE_PX = SIZE_MARK_MAX_DEPTH_MM * SOURCE_IMAGE_PPI / MILLIMETERS_PER_INCH;
export const SIZE_MARK_MAX_CENTER_FALLBACK_PX = 10;

export const SIZE_MARK_HEIGHT_PX = 18;
export const SIZE_MARK_MARGIN_PX = 0;
export const SIZE_MARK_MAX_EDGE_GAP_PX = SIZE_MARK_HEIGHT_PX;
export const SIZE_MARK_RGB = { red: 138, green: 255, blue: 0 } as const;

export interface SizeMarkMask {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

export interface SizeMarkRaster {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export interface SizeMarkBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const DIGITS: Readonly<Record<string, readonly string[]>> = {
  '0': ['01110', '11011', '11011', '11011', '11011', '11011', '01110'],
  '1': ['00110', '01110', '00110', '00110', '00110', '00110', '01111'],
  '2': ['01110', '11011', '00011', '00110', '01100', '11000', '11111'],
  '3': ['11110', '00011', '00011', '01110', '00011', '00011', '11110'],
  '4': ['00011', '00111', '01111', '11011', '11111', '00011', '00011'],
  '5': ['11111', '11000', '11000', '11110', '00011', '00011', '11110'],
  '6': ['01110', '11000', '11000', '11110', '11011', '11011', '01110'],
  '7': ['11111', '00011', '00110', '01100', '01100', '01100', '01100'],
  '8': ['01110', '11011', '11011', '01110', '11011', '11011', '01110'],
  '9': ['01110', '11011', '11011', '01111', '00011', '00011', '01110'],
};

type BoundarySegment = readonly [number, number, number, number];
interface BoundaryDistanceIndex {
  readonly cellSize: number;
  readonly columns: number;
  readonly bins: ReadonlyMap<number, readonly BoundarySegment[]>;
}

function createBoundaryDistanceIndex(raster: SizeMarkRaster): BoundaryDistanceIndex {
  const cellSize = 16;
  const columns = Math.ceil(raster.width / cellSize);
  const rows = Math.ceil(raster.height / cellSize);
  const mutableBins = new Map<number, BoundarySegment[]>();
  const components = extractAlphaComponents(raster, SIZE_MARK_CUT_ALPHA_THRESHOLD);
  for (const polygon of components) {
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i]!;
      const b = polygon[(i + 1) % polygon.length]!;
      const segment: BoundarySegment = [a.x, a.y, b.x, b.y];
      const minX = Math.max(0, Math.floor((Math.min(a.x, b.x) - SIZE_MARK_MAX_DEPTH_SOURCE_PX) / cellSize));
      const maxX = Math.min(columns - 1, Math.floor((Math.max(a.x, b.x) + SIZE_MARK_MAX_DEPTH_SOURCE_PX) / cellSize));
      const minY = Math.max(0, Math.floor((Math.min(a.y, b.y) - SIZE_MARK_MAX_DEPTH_SOURCE_PX) / cellSize));
      const maxY = Math.min(rows - 1, Math.floor((Math.max(a.y, b.y) + SIZE_MARK_MAX_DEPTH_SOURCE_PX) / cellSize));
      for (let cy = minY; cy <= maxY; cy++) for (let cx = minX; cx <= maxX; cx++) {
        const key = cy * columns + cx;
        const bucket = mutableBins.get(key);
        if (bucket) bucket.push(segment);
        else mutableBins.set(key, [segment]);
      }
    }
  }
  return { cellSize, columns, bins: mutableBins };
}

function pointToSegmentDistance(pointX: number, pointY: number, segment: BoundarySegment): number {
  const [ax, ay, bx, by] = segment;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((pointX - ax) * dx + (pointY - ay) * dy) / lengthSquared));
  return Math.hypot(pointX - (ax + t * dx), pointY - (ay + t * dy));
}

function validateDimensions(width: number, height: number, length: number, channels: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 ||
      width * height > 16_000_000 || length !== width * height * channels) {
    throw new Error('Dimensiones o datos raster inválidos para el número de talle.');
  }
}

/** Includes every nonzero sample, even faint antialiasing at the glyph's edges. */
export function visibleSizeMarkBounds(mask: SizeMarkMask): SizeMarkBounds {
  validateDimensions(mask.width, mask.height, mask.data.length, 1);
  let left = mask.width;
  let top = mask.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (mask.data[y * mask.width + x] === 0) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left) throw new Error('El glifo del número de talle no tiene píxeles visibles.');
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

/** Crops the measured ink and scales it to exactly 18 visible raster rows. */
export function normalizeSizeMarkGlyph(mask: SizeMarkMask): SizeMarkMask {
  const bounds = visibleSizeMarkBounds(mask);
  const height = SIZE_MARK_HEIGHT_PX;
  const width = Math.max(1, Math.round(bounds.width * height / bounds.height));
  validateDimensions(width, height, width * height, 1);
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const firstY = bounds.y + Math.floor(y * bounds.height / height);
    const endY = bounds.y + Math.ceil((y + 1) * bounds.height / height);
    for (let x = 0; x < width; x++) {
      const firstX = bounds.x + Math.floor(x * bounds.width / width);
      const endX = bounds.x + Math.ceil((x + 1) * bounds.width / width);
      for (let sy = firstY; sy < endY && data[y * width + x] === 0; sy++) {
        for (let sx = firstX; sx < endX; sx++) {
          if (mask.data[sy * mask.width + sx]! > 0) {
            data[y * width + x] = 255;
            break;
          }
        }
      }
    }
  }
  const normalized = { width, height, data };
  if (visibleSizeMarkBounds(normalized).height !== height) {
    throw new Error('No se pudo ajustar la altura visible del número a 18 px.');
  }
  return normalized;
}

/** Generates the same deterministic 5×7 numeral glyph for Moldes and migration. */
export function createSizeMarkGlyph(size: string): SizeMarkMask {
  if (!/^T(?:[1-9]|10)$/.test(size)) throw new Error('El número de talle debe ser 1–10.');
  const text = size.slice(1);
  const sourceWidth = text.length * 6 - 1;
  const source = new Uint8Array(sourceWidth * 7);
  for (const [digitIndex, digit] of [...text].entries()) {
    for (const [y, row] of DIGITS[digit]!.entries()) {
      for (const [x, cell] of [...row].entries()) {
        if (cell === '1') source[y * sourceWidth + digitIndex * 6 + x] = 255;
      }
    }
  }
  return normalizeSizeMarkGlyph({ width: sourceWidth, height: 7, data: source });
}

/**
 * Finds the highest top-center placement whose visible pixels belong to the
 * alpha-threshold-16 cut silhouette and stay within 6.5 mm inward from its
 * upper boundary. X fallbacks are limited to 10 source pixels to avoid drift.
 */
export function findSizeMarkPlacement(raster: SizeMarkRaster, mask: SizeMarkMask): SizeMarkBounds {
  validateDimensions(raster.width, raster.height, raster.data.length, 4);
  const ink = visibleSizeMarkBounds(mask);
  if (ink.x !== 0 || ink.y !== 0 || ink.width !== mask.width || ink.height !== mask.height ||
      ink.height !== SIZE_MARK_HEIGHT_PX) {
    throw new Error('El número debe tener su bbox visible recortado y una altura de 18 px.');
  }
  const noInterior = () => new Error('No hay una ubicación superior/central para el número de talle de 18 px dentro de alpha >16 y a no más de 6,5 mm de profundidad.');
  if (mask.width > raster.width || mask.height > raster.height) throw noInterior();

  let left = raster.width;
  let right = -1;
  let top = raster.height;
  for (let y = 0; y < raster.height; y++) {
    for (let x = 0; x < raster.width; x++) {
      if (raster.data[(y * raster.width + x) * 4 + 3]! <= SIZE_MARK_CUT_ALPHA_THRESHOLD) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
    }
  }
  if (right < left) throw noInterior();
  const boundaries = createBoundaryDistanceIndex(raster);

  const preferredX = Math.round((left + right + 1 - mask.width) / 2);
  const maxX = raster.width - mask.width;
  const maxY = raster.height - mask.height;

  // Scan from the top down first, then prefer the closest horizontal position.
  // This keeps the glyph at the top of the piece without drifting onto a shoulder.
  for (let y = top; y <= maxY; y++) {
    for (let horizontalDistance = 0; horizontalDistance <= SIZE_MARK_MAX_CENTER_FALLBACK_PX; horizontalDistance++) {
      const xs = horizontalDistance === 0
        ? [preferredX]
        : [preferredX - horizontalDistance, preferredX + horizontalDistance];
      for (const x of xs) {
        if (x < 0 || x > maxX) continue;
        const placement = { x, y, width: mask.width, height: mask.height };
        if (isSafeSizeMarkPlacement(raster, mask, placement, boundaries)) return placement;
      }
    }
  }
  throw noInterior();
}

/** Maximum alpha-threshold-16 run between each glyph column's top ink and its
 * nearest upper boundary. The physical depth limit is enforced separately.
 */
export function measureSizeMarkEdgeGapPx(
  raster: SizeMarkRaster,
  mask: SizeMarkMask,
  placement: SizeMarkBounds,
): number {
  validateDimensions(raster.width, raster.height, raster.data.length, 4);
  let maximumGap = 0;
  for (let x = 0; x < mask.width; x++) {
    if (mask.data[x] === 0) continue;
    const imageX = placement.x + x;
    let run = 0;
    let firstInkY = -1;
    for (let my = 0; my < mask.height; my++) {
      if (mask.data[my * mask.width + x] !== 0) { firstInkY = placement.y + my; break; }
    }
    for (let y = firstInkY - 1; y >= 0; y--) {
      if (raster.data[(y * raster.width + imageX) * 4 + 3]! <= SIZE_MARK_CUT_ALPHA_THRESHOLD) break;
      run++;
    }
    maximumGap = Math.max(maximumGap, run);
    if (run > SIZE_MARK_MAX_EDGE_GAP_PX) return run;
  }
  return maximumGap;
}

function isSafeSizeMarkPlacement(
  raster: SizeMarkRaster,
  mask: SizeMarkMask,
  placement: SizeMarkBounds,
  boundaries: BoundaryDistanceIndex,
): boolean {
  const inkPoints: { x: number; y: number }[] = [];
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (mask.data[y * mask.width + x] === 0) continue;
      const sourceX = placement.x + x;
      const sourceY = placement.y + y;
      const alpha = raster.data[(sourceY * raster.width + sourceX) * 4 + 3]!;
      if (alpha <= SIZE_MARK_CUT_ALPHA_THRESHOLD) return false;
      inkPoints.push({ x: sourceX + 0.5, y: sourceY + 0.5 });
    }
  }
  for (const point of inkPoints) {
    const cellX = Math.floor(point.x / boundaries.cellSize);
    const cellY = Math.floor(point.y / boundaries.cellSize);
    const candidates = boundaries.bins.get(cellY * boundaries.columns + cellX);
    if (!candidates?.length) return false;
    let nearest = Infinity;
    for (const segment of candidates) nearest = Math.min(nearest, pointToSegmentDistance(point.x, point.y, segment));
    if (nearest > SIZE_MARK_MAX_DEPTH_SOURCE_PX) return false;
  }
  return inkPoints.length > 0;
}

/** Mutates RGB only after validating the whole placement; alpha is untouched. */
export function stampSizeMark(raster: SizeMarkRaster, mask: SizeMarkMask): SizeMarkBounds {
  const placement = findSizeMarkPlacement(raster, mask);
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (mask.data[y * mask.width + x] === 0) continue;
      const offset = ((placement.y + y) * raster.width + placement.x + x) * 4;
      raster.data[offset] = SIZE_MARK_RGB.red;
      raster.data[offset + 1] = SIZE_MARK_RGB.green;
      raster.data[offset + 2] = SIZE_MARK_RGB.blue;
    }
  }
  return placement;
}

/** Confirms the intended glyph is exact green, in cut alpha, and alpha is unchanged. */
export function validateSizeMark(
  raster: SizeMarkRaster,
  originalAlpha: Uint8Array,
  mask: SizeMarkMask,
  placement: SizeMarkBounds,
): void {
  validateDimensions(raster.width, raster.height, raster.data.length, 4);
  if (originalAlpha.length !== raster.width * raster.height || placement.width !== mask.width ||
      placement.height !== mask.height || placement.x < 0 || placement.y < 0 ||
      placement.x + placement.width > raster.width || placement.y + placement.height > raster.height) {
    throw new Error('No se pudo validar el bbox visible del número de talle.');
  }
  let visible = 0;
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (mask.data[y * mask.width + x] === 0) continue;
      visible++;
      const imageOffset = (placement.y + y) * raster.width + placement.x + x;
      const rgbaOffset = imageOffset * 4;
      if (originalAlpha[imageOffset]! <= SIZE_MARK_CUT_ALPHA_THRESHOLD || raster.data[rgbaOffset + 3] !== originalAlpha[imageOffset] ||
          raster.data[rgbaOffset] !== SIZE_MARK_RGB.red || raster.data[rgbaOffset + 1] !== SIZE_MARK_RGB.green ||
          raster.data[rgbaOffset + 2] !== SIZE_MARK_RGB.blue) {
        throw new Error('El número de talle sale de la silueta opaca original o no es #8aff00.');
      }
    }
  }
  if (visible === 0 || visibleSizeMarkBounds(mask).height !== SIZE_MARK_HEIGHT_PX) {
    throw new Error('El bbox visible del número de talle debe tener 18 px de alto.');
  }
}
