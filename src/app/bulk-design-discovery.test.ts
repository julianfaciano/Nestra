import { expect, it, vi } from 'vitest';
import { deduplicateDesignRoots, discoverBulkDesignFolders, normalizeDesignSourcePath, type DesignDirectory } from './bulk-design-discovery';

function directory(path: string, files: string[] = [], children: string[] = []): DesignDirectory {
  return { path, name: path.split('/').at(-1)!, pngFileNames: files, directFileCount: files.length,
    children: children.map(path => ({ path, name: path.split('/').at(-1)! })), skippedLinkPaths: [] };
}
function inspectTree(directories: DesignDirectory[]) {
  const map = new Map(directories.map(folder => [normalizeDesignSourcePath(folder.path), folder]));
  return vi.fn(async (path: string) => { const folder = map.get(normalizeDesignSourcePath(path)); if (!folder) throw new Error(`Missing ${path}`); return folder; });
}
const oneAsset = ['CODE_0000_T1-FRENTE.png'];

it('finds three independent Argentina designs under a dot root without making either parent a design', async () => {
  const root = 'S:/.fanaticotas'; const parent = `${root}/Argentina`;
  const paths = ['Argentina 2024', 'Argentina 2026', 'Argentina 2026 Suplente'].map(name => `${parent}/${name}`);
  const scan = await discoverBulkDesignFolders([{ path: root, name: '.fanaticotas' }], inspectTree([
    directory(root, [], [parent]), directory(parent, [], paths), ...paths.map(path => directory(path, oneAsset)),
  ]));
  expect(scan.designFolders.map(folder => folder.name)).toEqual(['Argentina 2024', 'Argentina 2026', 'Argentina 2026 Suplente']);
  expect(scan.directoriesVisited).toBe(5); expect(scan.containerCount).toBe(2); expect(scan.noAssetsCount).toBe(2);
});

it('finds a design at four nested levels and keeps dot designs eligible', async () => {
  const paths = ['S:/root', 'S:/root/grupo', 'S:/root/grupo/temporada', 'S:/root/grupo/temporada/nivel', 'S:/root/grupo/temporada/nivel/.diseño'];
  const scan = await discoverBulkDesignFolders([{ path: paths[0]!, name: 'root' }], inspectTree(paths.map((path,index) => directory(path, index === 4 ? oneAsset : [], paths[index + 1] ? [paths[index + 1]!] : []))));
  expect(scan.designFolders.map(folder => folder.name)).toEqual(['.diseño']); expect(scan.directoriesVisited).toBe(5);
});

it('continues into a child even when the parent has its own recognizable assets', async () => {
  const scan = await discoverBulkDesignFolders([{ path: 'S:/Foo', name: 'Foo' }], inspectTree([
    directory('S:/Foo', oneAsset, ['S:/Foo/Foo Especial']), directory('S:/Foo/Foo Especial', ['OTHER_0001_T1-DORSO.png']),
  ]));
  expect(scan.designFolders.map(folder => [folder.name,folder.pngFileNames])).toEqual([['Foo',oneAsset],['Foo Especial',['OTHER_0001_T1-DORSO.png']]]);
});

it('accepts directly selected design folders and eliminates duplicate/overlapping roots', async () => {
  const inspect = inspectTree([directory('S:/.root', [], ['S:/.root/River']), directory('S:/.root/River', oneAsset)]);
  const scan = await discoverBulkDesignFolders([{path:'S:/.root/River',name:'River'}, {path:'s:\\.ROOT\\',name:'.root'}, {path:'S:/.root',name:'.root'}], inspect);
  expect(inspect).toHaveBeenCalledTimes(2); expect(scan.designFolders).toHaveLength(1); expect(scan.overlappingRootCount).toBe(2);
  const direct = await discoverBulkDesignFolders([{path:'S:/.root/River',name:'River'}], inspect);
  expect(direct.designFolders).toHaveLength(1);
});

it('does not collapse sibling path prefixes and normalizes extended Windows paths', () => {
  expect(deduplicateDesignRoots([{path:'S:/Root/River',name:'River'},{path:'S:/Root/River2',name:'River2'}])).toHaveLength(2);
  expect(normalizeDesignSourcePath('\\\\?\\C:\\A\\B\\..\\C\\')).toBe('c:/a/c');
});

it('processes each physical directory once even when an adapter returns aliases or a cycle', async () => {
  const inspect = vi.fn(async (path: string) => path === 'S:/root' ? directory(path,oneAsset,['S:/alias']) : directory('S:/root',oneAsset,['S:/root']));
  const scan = await discoverBulkDesignFolders([{path:'S:/root',name:'root'}],inspect);
  expect(inspect).toHaveBeenCalledTimes(2); expect(scan.directoriesVisited).toBe(1); expect(scan.designFolders).toHaveLength(1);
});

it('records read errors and skipped links while continuing safe sibling directories', async () => {
  const inspect=vi.fn(async(path:string)=> {if(path==='S:/root/bad')throw new Error('Access denied'); return path==='S:/root' ? {...directory(path,[],['S:/root/bad','S:/root/good']),skippedLinkPaths:['S:/root/junction']} : directory(path,oneAsset);});
  const scan=await discoverBulkDesignFolders([{path:'S:/root',name:'root'}],inspect);
  expect(scan.errors).toEqual([{path:'S:/root/bad',message:'Access denied'}]); expect(scan.designFolders.map(folder=>folder.name)).toEqual(['good']); expect(scan.skippedLinkPaths).toEqual(['S:/root/junction']);
});
