import type { PieceSide } from './piece-side';
import type { GarmentSize } from './size';

export interface ParsedDesignAssetFilename {
  readonly size: GarmentSize;
  readonly side: PieceSide;
}

function expectedSequence(
  sizeNumber: number,
  side: PieceSide,
): number {
  return (
    (sizeNumber - 1) * 2 +
    (side === 'back' ? 1 : 0)
  );
}

export function parseDesignAssetFilename(
  fileName: string,
): ParsedDesignAssetFilename | null {
  /*
   * Formatos válidos, por ejemplo:
   *
   * ARG26E_0000_T1-FRENTE.png
   * ARG26E_0001_T1-DORSO.png
   * RIV26S_0018_T10-FRENTE.png
   * RIV26S_0019_T10-DORSO.png
   *
   * El nombre debe empezar directamente con el código
   * del diseño. No se acepta texto adicional separado
   * delante del nombre original.
   */
  const match = fileName.match(
    /^[^\s\\/]+_(\d{4})_T(10|[1-9])-(FRENTE|DORSO)\.png$/i,
  );

  if (!match) {
    return null;
  }

  const sequenceText = match[1];
  const sizeText = match[2];
  const sideText = match[3];

  if (!sequenceText || !sizeText || !sideText) {
    return null;
  }

  const sizeNumber = Number(sizeText);

  const side: PieceSide =
    sideText.toUpperCase() === 'FRENTE'
      ? 'front'
      : 'back';

  const sequence = Number(sequenceText);

  if (
    sequence !== expectedSequence(sizeNumber, side)
  ) {
    return null;
  }

  return {
    size: `T${sizeNumber}` as GarmentSize,
    side,
  };
}