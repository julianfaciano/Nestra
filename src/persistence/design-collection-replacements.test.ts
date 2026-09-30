// @vitest-environment node
import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { buildDesignCollection, findCollectionReplacementAssets } from '../app/design-collection-state';
import { loadDesignCollections, saveDesignCollections } from './design-collections';

it('persists exact personalized BACK bytes in the same slot and loads legacy Library data', async () => {
  const files = [
    new File(['standard'], 'ARG26E_0019_T10-DORSO.png', { type: 'image/png' }),
    new File(['BENJI pixels'], 'aanomBENJI ARG26E_0019_T10-DORSO.png', { type: 'image/png' }),
    new File(['CHICHA pixels'], 'aanomCHICHA ARG26E_0019_T10-DORSO.png', { type: 'image/png' }),
  ];
  const original = buildDesignCollection(files, 'names');
  await saveDesignCollections([original]);
  const [loaded] = await loadDesignCollections();
  expect(loaded?.assets).toHaveLength(1);
  expect(loaded?.replacementAssets).toHaveLength(2);
  const options = findCollectionReplacementAssets(loaded!, 'T10', 'back');
  expect(options.map(asset => asset.fileName)).toEqual(files.map(file => file.name));
  expect(await Promise.all(options.map(asset => asset.file.text()))).toEqual(['standard', 'BENJI pixels', 'CHICHA pixels']);
  const { replacementAssets: _replacements, ...legacy } = original;
  await saveDesignCollections([legacy]);
  const [legacyLoaded] = await loadDesignCollections();
  expect(legacyLoaded?.replacementAssets).toBeUndefined();
  expect(legacyLoaded?.assets).toHaveLength(1);
});

it('persists the real space-separated nom BACK beside the canonical T4 source under its folder', async () => {
  const files = [
    new File(['FIRULAIS edited pixels'], 'aanomFIRULAIS SLE_D_T4.png', { type: 'image/png' }),
    new File(['standard pixels'], 'SLE_0007_T4-DORSO.png', { type: 'image/png' }),
  ];
  for (const file of files) Object.defineProperty(file, 'webkitRelativePath', { value: `San Lorenzo Escudo/${file.name}` });
  await saveDesignCollections([buildDesignCollection(files, 'san-lorenzo')]);
  const [loaded] = await loadDesignCollections();
  expect(loaded?.name).toBe('San Lorenzo Escudo');
  const options = findCollectionReplacementAssets(loaded!, 'T4', 'back');
  expect(options.map(asset => asset.fileName)).toEqual(['SLE_0007_T4-DORSO.png', 'aanomFIRULAIS SLE_D_T4.png']);
  expect(await Promise.all(options.map(asset => asset.file.text()))).toEqual(['standard pixels', 'FIRULAIS edited pixels']);
});
