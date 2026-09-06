import type { GarmentSize } from '../domain/size';
import type { PieceSide } from '../domain/piece-side';

export interface SizeTemplateDraft {
  readonly size: GarmentSize;
  readonly side: PieceSide;
  readonly file?: File | undefined;
  readonly previewUrl?: string | undefined;
  readonly widthPx?: number | undefined;
  readonly heightPx?: number | undefined;
  readonly physicalWidthMm?: number | undefined;
  readonly physicalHeightMm?: number | undefined;
  readonly alphaThreshold?: number | undefined;
  readonly simplificationTolerancePx?: number | undefined;
}
