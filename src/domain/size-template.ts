import type { PieceSide } from './piece-side';
import type { GarmentSize } from './size';
import type { Millimeters } from './units';

export interface SizeTemplateSource {
  readonly fileName: string;
  readonly mimeType: 'image/png';
  readonly widthPx: number;
  readonly heightPx: number;
}

export interface SizeTemplatePhysicalSize {
  readonly width: Millimeters;
  readonly height: Millimeters;
}

export interface SizeTemplate {
  readonly id: string;
  readonly size: GarmentSize;
  readonly side: PieceSide;
  readonly physicalSize: SizeTemplatePhysicalSize;
  readonly source: SizeTemplateSource;

  /**
   * Se completará cuando implementemos la extracción de contorno.
   */
  readonly contourId?: string;
}

export function createSizeTemplateId(
  size: GarmentSize,
  side: PieceSide,
): string {
  return `${size.toLowerCase()}-${side}`;
}
