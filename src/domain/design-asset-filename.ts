import type { PieceSide } from './piece-side';
import { GARMENT_SIZES, type GarmentSize } from './size';

export interface ParsedDesignAssetFilename {
  readonly size: GarmentSize;
  readonly side: PieceSide;
  /** Present for the human-readable, terminal-token filename format. */
  readonly designName?: string;
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
  const legacyMatch = fileName.match(
    /^[^\s\\/]+_(\d{4})_T(10|[1-9])-(FRENTE|DORSO)\.png$/i,
  );

  if (legacyMatch) {
    const sequenceText = legacyMatch[1];
    const sizeText = legacyMatch[2];
    const sideText = legacyMatch[3];

    if (!sequenceText || !sizeText || !sideText) {
      return null;
    }

    const sizeNumber = Number(sizeText);
    const side: PieceSide =
      sideText.toUpperCase() === 'FRENTE' ? 'front' : 'back';
    const sequence = Number(sequenceText);

    if (sequence !== expectedSequence(sizeNumber, side)) {
      return null;
    }

    return {
      size: `T${sizeNumber}` as GarmentSize,
      side,
    };
  }

  /*
   * Formato humano. Los tokens se leen exclusivamente desde el final para
   * que números internos del nombre no puedan confundirse con el talle.
   */
  const readableMatch = fileName.match(
    /^(.+?)[ _-]+T(10|[1-9])[ _-]+(FRENTE|DORSO)\.png$/i,
  );

  const designName = readableMatch?.[1]
    ?.replace(/[ _-]+$/g, '')
    .replace(/[ _-]+/g, ' ')
    .trim();
  const sizeText = readableMatch?.[2];
  const sideText = readableMatch?.[3];

  if (
    !designName ||
    !sizeText ||
    !sideText ||
    /\s+\S+_\d{4}$/i.test(readableMatch?.[1] ?? '')
  ) {
    return null;
  }

  return {
    size: `T${Number(sizeText)}` as GarmentSize,
    side: sideText.toUpperCase() === 'FRENTE' ? 'front' : 'back',
    designName,
  };
}

/** Reposición only: preserve the strict parser used to pair full garments. */
export function parseReplacementAssetFilename(
  fileName: string,
): ParsedDesignAssetFilename | null {
  // Productive convention: "nom" anywhere in the PNG basename means BACK.
  // Do not infer a design from this filename; Library owns the folder association.
  const basename = /^([^\\/]+)\.png$/i.exec(fileName)?.[1];
  if (!basename) return null;
  if (!/nom/i.test(basename)) return parseDesignAssetFilename(fileName);

  // Only separate T tokens are sizes, never digits embedded in a name/code.
  // Reject unknown or conflicting sizes instead of choosing one arbitrarily.
  const sizes = new Set(Array.from(
    basename.matchAll(/(?:^|[ _-])T(\d+)(?=$|[ _-])/gi),
    match => `T${match[1]}`,
  ));
  const size = [...sizes][0];
  if (sizes.size !== 1 || !GARMENT_SIZES.some(valid => valid === size)) return null;
  return { size: size as GarmentSize, side: 'back' };
}

/** True when a direct PNG basename identifies a productive asset understood by Library. */
export function isRecognizableDesignAssetFilename(fileName: string): boolean {
  if (/^00.+\((F|D)\)\.png$/i.test(fileName)) return true;
  const parsed = /nom/i.test(fileName.replace(/\.png$/i, ''))
    ? parseReplacementAssetFilename(fileName)
    : parseDesignAssetFilename(fileName);
  return parsed !== null;
}
