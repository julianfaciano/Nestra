import type { PieceSide } from '../domain/piece-side';
import type { GarmentSize } from '../domain/size';
import type { FillSetting } from '../domain/fill-gaps';

export interface BatchPieceDraft {
  readonly kind: 'garment';
  readonly id: string;
  readonly model: string;
  readonly size: GarmentSize;
  readonly side: PieceSide;
  readonly fabric: string;
  readonly quantity: number;
  readonly file?: File | undefined;
  readonly imageUrl?: string | undefined;
  readonly sourceWidthPx?: number | undefined;
  readonly sourceHeightPx?: number | undefined;
}

export interface FreePngDraft {
  readonly fill?: FillSetting | undefined;
  readonly kind: 'free-png';
  readonly id: string;
  readonly fabric: string;
  readonly quantity: number;
  readonly file: File;
  readonly imageUrl: string;
  readonly sourceWidthPx: number;
  readonly sourceHeightPx: number;
}

export type ProductionPieceDraft = BatchPieceDraft | FreePngDraft;
