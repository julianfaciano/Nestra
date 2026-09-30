import {
  parseDesignAssetFilename,
  parseReplacementAssetFilename,
  type ParsedDesignAssetFilename,
} from './design-asset-filename';
import { GARMENT_SIZES, type GarmentSize } from './size';
import { PIECE_SIDES, type PieceSide } from './piece-side';

export interface DesignFileCandidate {
  readonly fileName: string;
  readonly relativePath: string;
}

export interface DesignCollectionAssetDescriptor
  extends ParsedDesignAssetFilename {
  readonly fileName: string;
  readonly relativePath: string;
}

export interface MissingDesignAsset {
  readonly size: GarmentSize;
  readonly side: PieceSide;
}

export interface DesignCollectionScanResult {
  readonly name: string;
  readonly assets: readonly DesignCollectionAssetDescriptor[];
  readonly replacementAssets: readonly DesignCollectionAssetDescriptor[];
  readonly missing: readonly MissingDesignAsset[];
  readonly duplicateSlots: readonly string[];
  readonly ignoredFileNames: readonly string[];
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/');
}

export function collectionNameFromRelativePath(
  relativePath: string,
): string {
  const normalized = normalizePath(relativePath);
  const parts = normalized
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length >= 2) {
    return parts[0] ?? 'Diseño importado';
  }

  return 'Diseño importado';
}

function slotKey(
  size: GarmentSize,
  side: PieceSide,
): string {
  return `${size}:${side}`;
}

export function scanDesignCollection(
  files: readonly DesignFileCandidate[],
): DesignCollectionScanResult {
  if (files.length === 0) {
    return {
      name: 'Diseño importado',
      assets: [],
      replacementAssets: [],
      missing: GARMENT_SIZES.flatMap((size) =>
        PIECE_SIDES.map((side) => ({
          size,
          side,
        })),
      ),
      duplicateSlots: [],
      ignoredFileNames: [],
    };
  }

  let name = collectionNameFromRelativePath(files[0]?.relativePath ?? '');

  const assets: DesignCollectionAssetDescriptor[] = [];
  const replacementAssets: DesignCollectionAssetDescriptor[] = [];
  const ignoredFileNames: string[] = [];
  const duplicateSlots: string[] = [];
  const usedSlots = new Set<string>();

  for (const file of files) {
    // Named sources are replacement-only even if their remaining tokens would
    // otherwise match a canonical FRONT/BACK filename. They never claim a slot.
    const parsed = /nom/i.test(file.fileName.replace(/\.png$/i, ''))
      ? null
      : parseDesignAssetFilename(file.fileName);

    if (!parsed) {
      const replacement = parseReplacementAssetFilename(file.fileName);
      if (replacement?.side === 'back') {
        if (!replacementAssets.some(asset => asset.relativePath === file.relativePath)) {
          replacementAssets.push({ ...file, size: replacement.size, side: replacement.side });
        }
        continue;
      }
      ignoredFileNames.push(file.fileName);
      continue;
    }

    const key = slotKey(parsed.size, parsed.side);

    if (usedSlots.has(key)) {
      duplicateSlots.push(key);
      if (parsed.side === 'back' && ![...assets, ...replacementAssets].some(asset => asset.relativePath === file.relativePath)) {
        replacementAssets.push({ ...file, size: parsed.size, side: parsed.side });
      }
      continue;
    }

    usedSlots.add(key);

    if (parsed.designName) {
      name = parsed.designName;
    }

    assets.push({
      fileName: file.fileName,
      relativePath: file.relativePath,
      size: parsed.size,
      side: parsed.side,
    });
  }

  const missing: MissingDesignAsset[] = [];

  for (const size of GARMENT_SIZES) {
    for (const side of PIECE_SIDES) {
      if (!usedSlots.has(slotKey(size, side))) {
        missing.push({
          size,
          side,
        });
      }
    }
  }

  return {
    name,
    assets,
    replacementAssets,
    missing,
    duplicateSlots,
    ignoredFileNames,
  };
}
