import { isRecognizableDesignAssetFilename } from '../domain/design-asset-filename';

export interface DesignFolderRoot {
  readonly path: string;
  readonly name: string;
}

export interface DesignDirectory extends DesignFolderRoot {
  readonly pngFileNames: readonly string[];
  readonly directFileCount: number;
  readonly children: readonly DesignFolderRoot[];
  readonly skippedLinkPaths: readonly string[];
  readonly readError?: string;
}

export interface BulkDesignDiscovery {
  readonly roots: readonly DesignFolderRoot[];
  readonly directories: readonly DesignDirectory[];
  readonly designFolders: readonly DesignDirectory[];
  readonly directoriesVisited: number;
  readonly containerCount: number;
  readonly noAssetsCount: number;
  readonly overlappingRootCount: number;
  readonly skippedLinkPaths: readonly string[];
  readonly errors: readonly { path: string; message: string }[];
}

/** Path identity, independent of spelling, separators, or the visible folder name. */
export function normalizeDesignSourcePath(path: string): string {
  const slashPath = path.trim().replaceAll('\\', '/').replace(/^\/\/\?\/UNC\//i, '//').replace(/^\/\/\?\//, '');
  const prefix = slashPath.startsWith('//') ? '//' : slashPath.startsWith('/') ? '/' : '';
  const parts: string[] = [];
  for (const part of slashPath.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..' && parts.length && !parts.at(-1)?.endsWith(':')) parts.pop();
    else if (part !== '..') parts.push(part);
  }
  return (prefix + parts.join('/')).toLowerCase();
}

export function deduplicateDesignRoots(roots: readonly DesignFolderRoot[]): DesignFolderRoot[] {
  const sorted = [...roots].sort((a, b) => normalizeDesignSourcePath(a.path).length - normalizeDesignSourcePath(b.path).length);
  const accepted: DesignFolderRoot[] = [];
  for (const root of sorted) {
    const key = normalizeDesignSourcePath(root.path);
    if (!key || accepted.some(parent => {
      const parentKey = normalizeDesignSourcePath(parent.path);
      return key === parentKey || key.startsWith(`${parentKey}/`);
    })) continue;
    accepted.push(root);
  }
  return accepted;
}

/** Recursion discovers directories only. Assets are always read separately and directly. */
export async function discoverBulkDesignFolders(
  selectedRoots: readonly DesignFolderRoot[],
  inspect: (path: string) => Promise<DesignDirectory>,
  onProgress?: (directoriesVisited: number, queuedDirectories: number) => void,
): Promise<BulkDesignDiscovery> {
  const roots = deduplicateDesignRoots(selectedRoots);
  const queue = [...roots];
  const queued = new Set(queue.map(root => normalizeDesignSourcePath(root.path)));
  const visited = new Set<string>();
  const directories: DesignDirectory[] = [];
  const errors: { path: string; message: string }[] = [];
  const skippedLinkPaths: string[] = [];
  for (let index = 0; index < queue.length; index += 1) {
    const root = queue[index]!;
    try {
      const directory = await inspect(root.path);
      const physicalPath = normalizeDesignSourcePath(directory.path);
      if (visited.has(physicalPath)) continue;
      visited.add(physicalPath);
      directories.push(directory);
      skippedLinkPaths.push(...directory.skippedLinkPaths);
      // A directory with assets can also contain independent nested designs.
      for (const child of directory.children) {
        const key = normalizeDesignSourcePath(child.path);
        if (!queued.has(key) && !visited.has(key)) {
          queued.add(key);
          queue.push(child);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ path: root.path, message });
      directories.push({ ...root, pngFileNames: [], directFileCount: 0, children: [], skippedLinkPaths: [], readError: message });
    }
    onProgress?.(directories.length, queue.length - index - 1);
    if (index % 24 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  const hasAssets = (directory: DesignDirectory) => directory.pngFileNames.some(isRecognizableDesignAssetFilename);
  const designFolders = directories.filter(hasAssets);
  return {
    roots,
    directories,
    designFolders,
    directoriesVisited: directories.length,
    containerCount: directories.filter(directory => !hasAssets(directory) && directory.children.length > 0).length,
    noAssetsCount: directories.filter(directory => !hasAssets(directory)).length,
    overlappingRootCount: selectedRoots.length - roots.length,
    skippedLinkPaths: [...new Set(skippedLinkPaths)],
    errors,
  };
}
