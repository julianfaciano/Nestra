import { normalizeDesignName } from '../domain/order-import';
import { isRecognizableDesignAssetFilename } from '../domain/design-asset-filename';
import { MAX_FREE_PNG_SOURCE_PIXELS } from './free-png-import';
import { buildDesignCollection, isCollectionComplete, type DesignCollection } from './design-collection-state';
import { normalizeDesignSourcePath } from './bulk-design-discovery';

export interface BulkDesignFolderInput {
  readonly path: string;
  readonly name: string;
  readonly files: readonly File[];
  readonly ignoredFileCount?: number;
  readonly readError?: string;
  readonly directFileCount?: number;
  readonly parserIgnoredFileNames?: readonly string[];
  readonly sourceFileNames?: readonly string[];
  readonly deferredFiles?: boolean;
}

export type BulkDesignConflict = 'new' | 'update' | 'ambiguous' | 'duplicate' | 'duplicate-slot' | 'incomplete' | 'no-assets' | 'read-error';

export interface BulkDesignCandidate {
  readonly path: string;
  readonly name: string;
  readonly collection?: DesignCollection;
  readonly existingId?: string;
  readonly complete: boolean;
  readonly conflict: BulkDesignConflict;
  readonly filesRecognized: number;
  readonly filesIgnored: number;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly identityPaths?: readonly string[];
  readonly directFileCount?: number;
  readonly parserIgnoredFileNames?: readonly string[];
  readonly sourceFileNames?: readonly string[];
  readonly deferredFiles?: boolean;
}

export interface BulkDesignScan {
  readonly candidates: readonly BulkDesignCandidate[];
  readonly selectedFolderCount: number;
  readonly recognizedCount: number;
  readonly filesIgnored: number;
  readonly completeCount: number;
  readonly incompleteCount: number;
  readonly conflictCount: number;
  readonly noAssetsCount: number;
  readonly warningCount: number;
}

function directFiles(folder: BulkDesignFolderInput): { files: File[]; ignored: number } {
  let ignored = folder.ignoredFileCount ?? 0;
  const files: File[] = [];
  for (const file of folder.files) {
    const relative = (file.webkitRelativePath || file.name).replaceAll('\\', '/').split('/').filter(Boolean);
    const direct = relative.length === 1
      ? relative[0] === file.name
      : relative.length === 2 && normalizeDesignName(relative[0] ?? '') === normalizeDesignName(folder.name) && relative[1] === file.name;
    if (direct && /\.png$/i.test(file.name)) files.push(file);
    else ignored += 1;
  }
  return { files, ignored };
}

async function validPng(file: File): Promise<boolean> {
  const signature = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (signature.length !== 8 || signature.some((byte, index) => byte !== [137, 80, 78, 71, 13, 10, 26, 10][index])) return false;
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file);
    return bitmap.width > 0 && bitmap.height > 0 && bitmap.width * bitmap.height <= MAX_FREE_PNG_SOURCE_PIXELS;
  } catch {
    return false;
  } finally {
    bitmap?.close();
  }
}

export async function scanBulkDesignFolders(
  folders: Iterable<BulkDesignFolderInput> | AsyncIterable<BulkDesignFolderInput>,
  existingCollections: readonly DesignCollection[],
  onProgress?: (completed: number, total: number) => void,
  totalFolders?: number,
  missingSourcePaths: ReadonlySet<string> = new Set(),
  retainFileContents = true,
): Promise<BulkDesignScan> {
  const candidates: BulkDesignCandidate[] = [];
  const visitedPaths = new Set<string>();
  let index = 0;
  for await (const folder of folders) {
    const folderKey = normalizeDesignSourcePath(folder.path);
    if (visitedPaths.has(folderKey)) continue;
    visitedPaths.add(folderKey);
    index += 1;
    const errors: string[] = folder.readError ? [folder.readError] : [];
    const warnings: string[] = [];
    if (folder.readError) {
      candidates.push({ path: folder.path, name: folder.name, complete: false, conflict: 'read-error', filesRecognized: 0, filesIgnored: folder.ignoredFileCount ?? 0, errors, warnings });
    } else {
      const direct = directFiles(folder);
      const validFiles: File[] = [];
      for (const file of direct.files) {
        if (!isRecognizableDesignAssetFilename(file.name)) {
          direct.ignored += 1;
          continue;
        }
        if (await validPng(file)) validFiles.push(file);
        else {
          direct.ignored += 1;
          warnings.push(`${file.name}: el archivo no es un PNG válido, no se pudo decodificar o supera el límite de píxeles.`);
        }
      }
      const metadataFiles = retainFileContents ? validFiles : validFiles.map(file => {
        const metadataFile = new File([], file.name, { type: 'image/png' });
        Object.defineProperty(metadataFile, 'webkitRelativePath', { value: file.webkitRelativePath });
        return metadataFile;
      });
      const parserIgnoredFileNames = [...new Set([...(folder.parserIgnoredFileNames ?? []), ...direct.files.filter(file => !isRecognizableDesignAssetFilename(file.name)).map(file => file.name)])];
      const builtCollection = validFiles.length
        ? buildDesignCollection(metadataFiles, crypto.randomUUID(), folder.path)
        : undefined;
      // The selected real design folder is the stable identity; filename tokens
      // determine slots but cannot rename or merge this folder's collection.
      const collection = builtCollection ? { ...builtCollection, name: folder.name, ignoredFileNames: [...new Set([...builtCollection.ignoredFileNames, ...parserIgnoredFileNames])] } : undefined;
      const filesRecognized = collection ? collection.assets.length + (collection.replacementAssets?.length ?? 0) + (collection.masterAssets?.length ?? 0) : 0;
      const masterFileNames = new Set(collection?.masterAssets?.map(asset => asset.fileName) ?? []);
      const unrecognizedPngCount = builtCollection?.ignoredFileNames.filter(name => !masterFileNames.has(name)).length ?? 0;
      const filesIgnored = direct.ignored + unrecognizedPngCount;
      if (!collection || filesRecognized === 0) {
        warnings.push('No se encontraron assets reconocibles en los archivos directos de esta carpeta.');
        candidates.push({ path: folder.path, name: folder.name, complete: false, conflict: 'no-assets', filesRecognized: 0, filesIgnored, errors, warnings });
      } else {
        const complete = isCollectionComplete(collection);
        if (collection.duplicateSlots.length) warnings.push(`Slots canónicos duplicados: ${collection.duplicateSlots.join(', ')}.`);
        else if (!complete) warnings.push(`Faltan assets canónicos: ${collection.missing.map(asset => `${asset.size} ${asset.side === 'front' ? 'Frente' : 'Dorso'}`).join(', ')}.`);
        if (unrecognizedPngCount) warnings.push(`${unrecognizedPngCount} PNG directos no coinciden con los patrones de assets.`);
        const pathMatches = existingCollections.filter(item => item.sourceFolderPath && normalizeDesignSourcePath(item.sourceFolderPath) === folderKey);
        const nameMatches = existingCollections.filter(item => normalizeDesignName(item.name) === normalizeDesignName(collection.name));
        const matches = pathMatches.length ? pathMatches : nameMatches;
        const wrongSourcePath = !pathMatches.length && matches.some(item => item.sourceFolderPath &&
          !missingSourcePaths.has(normalizeDesignSourcePath(item.sourceFolderPath)));
        const ambiguous = matches.length > 1 || wrongSourcePath;
        if (ambiguous) warnings.push('Identidad ambigua: hay varias colecciones equivalentes o una carpeta fuente distinta; no se modificará ninguna.');
        const conflict: BulkDesignConflict = collection.duplicateSlots.length ? 'duplicate-slot' : ambiguous ? 'ambiguous' : !complete ? 'incomplete' : matches.length === 1 ? 'update' : 'new';
        candidates.push({
          path: folder.path,
          name: folder.name,
          collection,
          ...(matches.length === 1 && !ambiguous ? { existingId: matches[0]!.id } : {}),
          identityPaths: [folder.path, ...matches.flatMap(item => item.sourceFolderPath ? [item.sourceFolderPath] : [])],
          directFileCount: folder.directFileCount ?? folder.files.length + (folder.ignoredFileCount ?? 0),
          parserIgnoredFileNames,
          sourceFileNames: validFiles.map(file => file.name).sort(),
          deferredFiles: !retainFileContents,
          complete,
          conflict,
          filesRecognized,
          filesIgnored,
          errors,
          warnings,
        });
      }
    }
    onProgress?.(index, totalFolders ?? index);
    if (index % 12 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
  }

  const pathsByName = new Map<string, number[]>();
  candidates.forEach((candidate, index) => {
    if (!candidate.collection) return;
    const key = normalizeDesignName(candidate.name);
    pathsByName.set(key, [...(pathsByName.get(key) ?? []), index]);
  });
  for (const indices of pathsByName.values()) {
    if (indices.length < 2) continue;
    for (const index of indices) {
      const candidate = candidates[index]!;
      candidates[index] = { ...candidate, conflict: 'duplicate', identityPaths: indices.map(item => candidates[item]!.path), warnings: [...candidate.warnings, 'Hay carpetas distintas con el mismo nombre; no se importará ninguna de esas identidades.'] };
    }
  }

  const completeCount = candidates.filter(candidate => candidate.complete).length;
  return {
    candidates,
    selectedFolderCount: candidates.length,
    recognizedCount: candidates.reduce((sum, candidate) => sum + candidate.filesRecognized, 0),
    filesIgnored: candidates.reduce((sum, candidate) => sum + candidate.filesIgnored, 0),
    completeCount,
    incompleteCount: candidates.filter(candidate => candidate.collection && !candidate.complete).length,
    conflictCount: candidates.filter(candidate => ['ambiguous', 'duplicate', 'duplicate-slot', 'read-error'].includes(candidate.conflict)).length,
    noAssetsCount: candidates.filter(candidate => candidate.conflict === 'no-assets').length,
    warningCount: candidates.reduce((sum, candidate) => sum + candidate.warnings.length, 0),
  };
}

export function canImportBulkCandidate(candidate: BulkDesignCandidate): boolean {
  return Boolean(candidate.collection && !candidate.errors.length && ['new', 'update', 'incomplete'].includes(candidate.conflict));
}

export function folderHasRecognizableDirectAssets(files: readonly File[]): boolean {
  return files.some(file => /\.png$/i.test(file.name) && isRecognizableDesignAssetFilename(file.name));
}
