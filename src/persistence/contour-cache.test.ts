// @vitest-environment node
import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { buildContourCacheKey, loadCachedContourPair, saveCachedContourPair } from './contour-cache';

it('isolates replacement geometry by PNG content and geometry mode, including same-name edits', async () => {
  const options = {
    alphaThreshold: 16, fastSimplificationPx: 3, fineSimplificationPx: 1.5,
    physicalWidthMm: 100, physicalHeightMm: 100,
  };
  const file = new File(['standard pixels'], 'back.png', { type: 'image/png' });
  const edited = new File(['name pixels outside standard silhouette'], 'back.png', { type: 'image/png' });
  const standardKey = await buildContourCacheKey(file, options);
  const replacementKey = await buildContourCacheKey(file, { ...options, geometryMode: 'all-visible-replacement' });
  const editedKey = await buildContourCacheKey(edited, { ...options, geometryMode: 'all-visible-replacement' });
  expect(new Set([standardKey, replacementKey, editedKey]).size).toBe(3);
  const bounds = { x: 0, y: 0, width: 100, height: 100 };
  const pair = {
    fastPolygon: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
    finePolygon: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
    sourceAlphaBounds: bounds, sourcePlacementBounds: bounds,
  };
  await saveCachedContourPair(standardKey, pair);
  expect(await loadCachedContourPair(editedKey)).toBeUndefined();
  expect(await loadCachedContourPair(replacementKey)).toBeUndefined();
  await saveCachedContourPair(editedKey, pair);
  expect(await loadCachedContourPair(editedKey)).toEqual(pair);
  expect(await buildContourCacheKey(edited, { ...options, geometryMode: 'all-visible-replacement' })).toBe(editedKey);
});
