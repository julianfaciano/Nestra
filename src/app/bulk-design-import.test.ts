import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { canImportBulkCandidate, scanBulkDesignFolders, type BulkDesignFolderInput } from './bulk-design-import';
import { normalizeDesignSourcePath } from './bulk-design-discovery';
import { mergeDesignCollectionList } from './design-collection-identity';

const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const sizes = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10'] as const;

beforeEach(() => {
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 10, height: 10, close: vi.fn() })));
  vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'candidate-id') });
});
afterEach(() => vi.unstubAllGlobals());

function png(name: string, relativePath: string): File {
  const file = new File([signature], name, { type: 'image/png' });
  Object.defineProperty(file, 'webkitRelativePath', { value: relativePath });
  return file;
}

function completeDesign(folder: string, code: string): File[] {
  return sizes.flatMap((size, index) => {
    const even = String(index * 2).padStart(4, '0');
    const odd = String(index * 2 + 1).padStart(4, '0');
    const front = `${code}_${even}_${size}-FRENTE.png`;
    const back = `${code}_${odd}_${size}-DORSO.png`;
    return [png(front, `${folder}/${front}`), png(back, `${folder}/${back}`)];
  });
}

function folder(name: string, path: string, files: readonly File[], ignoredFileCount = 0): BulkDesignFolderInput {
  return { name, path, files, ignoredFileCount };
}

it('maps one explicitly selected folder to exactly one complete candidate', async () => {
  const scan = await scanBulkDesignFolders([folder('Boca 2026', 'S:/Boca 2026', completeDesign('Boca 2026', 'BOCA'))], []);
  expect(scan.candidates).toHaveLength(1);
  expect(scan.candidates[0]).toMatchObject({ name: 'Boca 2026', complete: true, conflict: 'new' });
});

it('returns five candidates for five selected folders without parent grouping', async () => {
  const inputs = ['Boca 2026', 'Racing 2026', 'Argentina 2024', 'Argentina 2026', 'River 2026']
    .map((name, index) => folder(name, `S:/Colecciones/${name}`, completeDesign(name, `DES${index}`)));
  const scan = await scanBulkDesignFolders(inputs, []);
  expect(scan.selectedFolderCount).toBe(5);
  expect(scan.candidates.map(candidate => candidate.name)).toEqual(inputs.map(input => input.name));
  expect(scan.candidates.every(candidate => candidate.collection?.assets.length === 20)).toBe(true);
});

it('uses the selected design folder name as identity even when filenames carry another label', async () => {
  const files = sizes.flatMap(size => (['FRENTE', 'DORSO'] as const).map(side => {
    const name = `Etiqueta incorrecta ${size} ${side}.png`;
    return png(name, `Boca 2026 Suplente/${name}`);
  }));
  const scan = await scanBulkDesignFolders([folder('Boca 2026 Suplente', 'S:/Boca/Boca 2026 Suplente', files)], []);
  expect(scan.candidates[0]).toMatchObject({ name: 'Boca 2026 Suplente', conflict: 'new', complete: true });
  expect(scan.candidates[0]?.collection?.name).toBe('Boca 2026 Suplente');
});

it('blocks both complete candidates when distinct selected paths have the same basename', async () => {
  const scan = await scanBulkDesignFolders([
    folder('River 2026', 'S:/Norte/River 2026', completeDesign('River 2026', 'RIVN')),
    folder('River 2026', 'S:/Sur/River 2026', completeDesign('River 2026', 'RIVS')),
  ], []);
  expect(scan.candidates.map(candidate => candidate.conflict)).toEqual(['duplicate', 'duplicate']);
  expect(scan.candidates.every(candidate => candidate.collection?.assets.length === 20)).toBe(true);
});

it('does not absorb nested files; selecting the child separately creates one candidate', async () => {
  const childAssets = completeDesign('River 2026', 'RIV');
  const parent = folder('.fanaticotas', 'S:/.fanaticotas', childAssets.map(file => {
    const nested = new File([file], file.name, { type: 'image/png' });
    Object.defineProperty(nested, 'webkitRelativePath', { value: `.fanaticotas/River 2026/${file.name}` });
    return nested;
  }));
  const child = folder('River 2026', 'S:/.fanaticotas/River 2026', childAssets);
  const scan = await scanBulkDesignFolders([parent, child], []);
  expect(scan.candidates.map(candidate => candidate.conflict)).toEqual(['no-assets', 'new']);
  expect(scan.candidates[0]?.filesIgnored).toBe(20);
  expect(scan.candidates[1]?.collection?.assets).toHaveLength(20);
});

it('analyzes an explicitly selected dot folder when its direct files are valid', async () => {
  const scan = await scanBulkDesignFolders([folder('.algo', 'S:/.algo', completeDesign('.algo', 'DOT'))], []);
  expect(scan.candidates[0]).toMatchObject({ name: '.algo', conflict: 'new', complete: true });
});

it('shows a dot folder with only nested assets as no-assets without descending', async () => {
  const nested = png('DOT_0000_T1-FRENTE.png', '.algo/hijo/DOT_0000_T1-FRENTE.png');
  const scan = await scanBulkDesignFolders([folder('.algo', 'S:/.algo', [nested])], []);
  expect(scan.candidates[0]).toMatchObject({ conflict: 'no-assets', filesRecognized: 0, filesIgnored: 1 });
  expect(scan.noAssetsCount).toBe(1);
});

it('imports incomplete recognized designs while keeping their missing slots', async () => {
  const one = png('INC_0000_T1-FRENTE.png', 'Incomplete/INC_0000_T1-FRENTE.png');
  const scan = await scanBulkDesignFolders([folder('Incomplete', 'S:/Incomplete', [one])], []);
  expect(scan.candidates[0]).toMatchObject({ complete: false, conflict: 'incomplete' });
  expect(scan.incompleteCount).toBe(1);
  expect(canImportBulkCandidate(scan.candidates[0]!)).toBe(true);
  expect(scan.candidates[0]?.collection?.missing).toHaveLength(19);
});

it('marks duplicate canonical slots as a blocked conflict', async () => {
  const files = completeDesign('Boca', 'BOCA');
  const duplicate = png('OTHER_0000_T1-FRENTE.png', 'Boca/OTHER_0000_T1-FRENTE.png');
  const scan = await scanBulkDesignFolders([folder('Boca', 'S:/Boca', [...files, duplicate])], []);
  expect(scan.candidates[0]).toMatchObject({ conflict: 'duplicate-slot', complete: false });
  expect(scan.candidates[0]?.collection?.duplicateSlots).toEqual(['T1:front']);
});

it('keeps personalized nom backs as replacement alternatives, not canonical conflicts', async () => {
  const files = completeDesign('San Lorenzo', 'SLE26');
  const named = png('aanomFIRULAIS SLE26 T1-DORSO.png', 'San Lorenzo/aanomFIRULAIS SLE26 T1-DORSO.png');
  const scan = await scanBulkDesignFolders([folder('San Lorenzo', 'S:/San Lorenzo', [...files, named])], []);
  expect(scan.candidates[0]).toMatchObject({ conflict: 'new', complete: true });
  expect(scan.candidates[0]?.collection?.duplicateSlots).toEqual([]);
  expect(scan.candidates[0]?.collection?.replacementAssets).toHaveLength(1);
});

it('reimporting the same folder updates the same identity without multiplying nom or warnings', async () => {
  const files = [...completeDesign('Racing 2026', 'RAC26'), png('nomCHICHA RAC26 T2-DORSO.png', 'Racing 2026/nomCHICHA RAC26 T2-DORSO.png')];
  const first = await scanBulkDesignFolders([folder('Racing 2026', 'S:/Racing 2026', files)], []);
  const stored = { ...first.candidates[0]!.collection!, id: 'persisted-racing' };
  const second = await scanBulkDesignFolders([folder('Racing 2026', 'S:/Racing 2026', files)], [stored]);
  expect(second.candidates[0]).toMatchObject({ conflict: 'update', existingId: 'persisted-racing' });
  expect(second.candidates[0]?.collection?.replacementAssets).toHaveLength(1);
  expect(second.candidates[0]?.warnings).toEqual(first.candidates[0]?.warnings);
  const next = mergeDesignCollectionList([stored], [{ ...second.candidates[0]!.collection!, id: second.candidates[0]!.existingId! }]);
  const third = await scanBulkDesignFolders([folder('Racing 2026', 'S:/Racing 2026', completeDesign('Racing 2026', 'RAC26'))], next);
  const final = mergeDesignCollectionList(next, [{ ...third.candidates[0]!.collection!, id: third.candidates[0]!.existingId! }]);
  expect(final).toHaveLength(1); expect(final[0]?.replacementAssets).toEqual([]); expect(final[0]?.ignoredFileNames).toEqual([]);
});

it('prefers persisted source path over stale collection names and updates by id without duplicating', async () => {
  const first = await scanBulkDesignFolders([folder('Real folder', 'C:/Designs/Real folder', completeDesign('Real folder','CODE'))], []);
  const old = { ...first.candidates[0]!.collection!, name: 'Wrong old name', id: 'stored' };
  const second = await scanBulkDesignFolders([folder('Real folder', 'c:\\DESIGNS\\Real folder\\', completeDesign('Real folder','CODE'))], [old]);
  expect(second.candidates[0]).toMatchObject({existingId:'stored',name:'Real folder',conflict:'update'});
  const merged = mergeDesignCollectionList([old], [{...second.candidates[0]!.collection!,id:'stored'}]);
  expect(merged).toHaveLength(1); expect(merged[0]?.name).toBe('Real folder');
});

it('blocks a basename collision with another existing source path, including incomplete candidates', async () => {
  const old = (await scanBulkDesignFolders([folder('Same','S:/Old/Same',completeDesign('Same','OLD'))],[])).candidates[0]!.collection!;
  const scan = await scanBulkDesignFolders([folder('Same','S:/New/Same',[png('NEW_0000_T1-FRENTE.png','Same/NEW_0000_T1-FRENTE.png')])],[old]);
  expect(scan.candidates[0]?.conflict).toBe('ambiguous'); expect(canImportBulkCandidate(scan.candidates[0]!)).toBe(false);
  expect(scan.candidates[0]?.identityPaths).toEqual(['S:/New/Same','S:/Old/Same']);
  expect(()=>mergeDesignCollectionList([old],[{...old,id:'new-id',sourceFolderPath:'S:/New/Same'}])).toThrow(/Identidad ambigua/);
});

it('safely falls back to an unambiguous folder name when a persisted source path no longer exists', async () => {
  const old = (await scanBulkDesignFolders([folder('Same','S:/Old/Same',completeDesign('Same','OLD'))],[])).candidates[0]!.collection!;
  const scan = await scanBulkDesignFolders([folder('Same','S:/New/Same',completeDesign('Same','NEW'))],[old],undefined,undefined,new Set([normalizeDesignSourcePath('S:/Old/Same')]));
  expect(scan.candidates[0]).toMatchObject({conflict:'update',existingId:old.id});
});

it('deduplicates repeated physical folder inputs and releases decoded bitmaps and preview file bytes', async () => {
  const close=vi.fn();vi.stubGlobal('createImageBitmap',vi.fn(async()=>({width:10,height:10,close})));
  const input=folder('Same','S:/Same',completeDesign('Same','CODE'));
  const scan=await scanBulkDesignFolders([input,{...input,path:'s:\\SAME\\'}],[],undefined,undefined,undefined,false);
  expect(scan.candidates).toHaveLength(1);expect(close).toHaveBeenCalledTimes(20);expect(scan.candidates[0]?.deferredFiles).toBe(true);
  expect(scan.candidates[0]?.collection?.assets.every(asset=>asset.file.size===0)).toBe(true);
});

it('has no artificial folder cap and processes a large selection sequentially', async () => {
  const inputs = Array.from({ length: 60 }, (_, index) => {
    const name = `Diseño ${index}`;
    const fileName = `DES${String(index).padStart(4, '0')}_0000_T1-FRENTE.png`;
    return folder(name, `S:/${name}`, [png(fileName, `${name}/${fileName}`)]);
  });
  const progress = vi.fn();
  const scan = await scanBulkDesignFolders(inputs, [], progress);
  expect(scan.candidates).toHaveLength(60);
  expect(scan.incompleteCount).toBe(60);
  expect(progress).toHaveBeenLastCalledWith(60, 60);
});
