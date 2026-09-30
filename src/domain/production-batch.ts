import type { PieceSide } from './piece-side';
import type { GarmentSize } from './size';
import type { Millimeters } from './units';
import type { FillSetting } from './fill-gaps';

interface PieceDefinitionBase {
  readonly id: string;
  readonly fabric: string;
  readonly quantity: number;
  readonly fileName: string;
  readonly imageUrl: string;
  readonly sourceWidthPx: number;
  readonly sourceHeightPx: number;
  readonly physicalWidthMm: Millimeters;
  readonly physicalHeightMm: Millimeters;
  readonly alphaThreshold: number;
  readonly simplificationTolerancePx: number;
}

export interface GarmentPieceDefinition extends PieceDefinitionBase {
  readonly kind: 'garment';
  readonly model: string;
  readonly size: GarmentSize;
  readonly side: PieceSide;
}

export interface ReplacementPieceDefinition extends PieceDefinitionBase {
  readonly kind: 'replacement-piece';
  readonly collectionId: string;
  readonly model: string;
  readonly size: GarmentSize;
  readonly side: PieceSide;
}

export interface FreePngDefinition extends PieceDefinitionBase {
  readonly fill?: FillSetting | undefined;
  readonly kind: 'free-png';
}

export type BatchPieceDefinition = GarmentPieceDefinition | ReplacementPieceDefinition | FreePngDefinition;

export function pieceDefinitionLabel(piece: BatchPieceDefinition): string {
  return piece.kind === 'free-png' ? piece.fileName : piece.model;
}

export interface ProductionBatch {
  readonly id: string;
  readonly name: string;
  readonly pieces: readonly BatchPieceDefinition[];
}
