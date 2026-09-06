import {
  scanDesignCollection,
  type MissingDesignAsset,
} from '../domain/design-collection';
import type { PieceSide } from '../domain/piece-side';
import type { GarmentSize } from '../domain/size';

export interface DesignCollectionAsset {
  readonly size: GarmentSize;
  readonly side: PieceSide;
  readonly file: File;
  readonly fileName: string;
  readonly relativePath: string;
}

export interface DesignCollectionMasterAsset {
  readonly side: PieceSide;
  readonly file: File;
  readonly fileName: string;
  readonly relativePath: string;
}

export interface DesignCollection {
  readonly id: string;
  readonly name: string;
  readonly assets: readonly DesignCollectionAsset[];
  readonly missing: readonly MissingDesignAsset[];
  readonly duplicateSlots: readonly string[];
  readonly ignoredFileNames: readonly string[];
  readonly masterAssets?: readonly DesignCollectionMasterAsset[];
  readonly sourceFolderPath?: string;
}

function relativePathForFile(file: File): string {
  return file.webkitRelativePath || file.name;
}

function masterSideFromFileName(
  fileName: string,
): PieceSide | undefined {
  const match = /^00.+\((F|D)\)\.png$/i.exec(fileName);

  if (!match) {
    return undefined;
  }

  const sideCode = match[1];

if (!sideCode) {
  return undefined;
}

return sideCode.toUpperCase() === 'F' ? 'front' : 'back';
}

export function buildDesignCollection(
  files: readonly File[],
  id: string,
  sourceFolderPath?: string,
): DesignCollection {
  const candidates = files.map((file) => ({
    fileName: file.name,
    relativePath: relativePathForFile(file),
  }));

  const scan = scanDesignCollection(candidates);

  const fileByRelativePath = new Map<string, File>();

  for (const file of files) {
    fileByRelativePath.set(
      relativePathForFile(file),
      file,
    );
  }

  const assets: DesignCollectionAsset[] = [];

  const masterAssets: DesignCollectionMasterAsset[] = [];

for (const file of files) {
  const side = masterSideFromFileName(file.name);

  if (!side) {
    continue;
  }

  /*
   * Si por accidente hubiera más de un maestro del mismo lado,
   * conservamos el primero de forma determinista.
   */
  if (masterAssets.some((asset) => asset.side === side)) {
    continue;
  }

  masterAssets.push({
    side,
    file,
    fileName: file.name,
    relativePath: relativePathForFile(file),
  });
}

  for (const descriptor of scan.assets) {
    const file = fileByRelativePath.get(
      descriptor.relativePath,
    );

    if (!file) {
      continue;
    }

    assets.push({
      size: descriptor.size,
      side: descriptor.side,
      file,
      fileName: descriptor.fileName,
      relativePath: descriptor.relativePath,
    });
  }

  return {
  id,
  ...(sourceFolderPath ? { sourceFolderPath } : {}),
  name: scan.name,
  assets,
  masterAssets,
  missing: scan.missing,
  duplicateSlots: scan.duplicateSlots,
  ignoredFileNames: scan.ignoredFileNames,
};
}

export function findCollectionAsset(
  collection: DesignCollection,
  size: GarmentSize,
  side: PieceSide,
): DesignCollectionAsset | undefined {
  return collection.assets.find(
    (asset) =>
      asset.size === size &&
      asset.side === side,
  );
}

export function findCollectionPreviewAsset(
  collection: DesignCollection,
  side: PieceSide,
): DesignCollectionMasterAsset | DesignCollectionAsset | undefined {
  const master = collection.masterAssets?.find(
    (asset) => asset.side === side,
  );

  if (master) {
    return master;
  }

  /*
   * Compatibilidad con colecciones importadas antes de que
   * empezáramos a persistir los archivos maestros.
   */
  return findCollectionAsset(collection, 'T8', side);
}

export function isCollectionComplete(
  collection: DesignCollection,
): boolean {
  return (
    collection.assets.length === 20 &&
    collection.missing.length === 0 &&
    collection.duplicateSlots.length === 0
  );
}
