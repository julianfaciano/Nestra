export const SOURCE_IMAGE_PPI = 72;
const MILLIMETERS_PER_INCH = 25.4;

export interface SourceImagePhysicalSize {
  readonly widthMm: number;
  readonly heightMm: number;
}

export function millimetersFromSourcePixels(
  pixels: number,
): number {
  if (!Number.isFinite(pixels) || pixels <= 0) {
    throw new Error(
      'La dimensión raster debe ser mayor que cero.',
    );
  }

  return (
    (pixels / SOURCE_IMAGE_PPI) *
    MILLIMETERS_PER_INCH
  );
}

export function physicalSizeFromSourcePixels(
  widthPx: number,
  heightPx: number,
): SourceImagePhysicalSize {
  return {
    widthMm: millimetersFromSourcePixels(widthPx),
    heightMm: millimetersFromSourcePixels(heightPx),
  };
}