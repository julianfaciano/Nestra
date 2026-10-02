import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePrefix, classifyCanonicalFilename, assertOutside } from './regenerate-canonical-molds.mjs';
import { createServer } from 'vite';

test('prefix resolution never guesses an unrelated mixed prefix', () => {
  assert.equal(resolvePrefix([{ prefix: 'A' }, { prefix: 'B' }], 'A', 'A', () => undefined).error, 'prefix-ambiguous');
});
test('a unique existing prefix is preserved even when masters differ', () => {
  assert.equal(resolvePrefix([{ prefix: 'BJ26' }], '00BJ26', '00BJ26', () => undefined).prefix, 'BJ26');
});
test('only a complete, coherent T9/T10 zero-prefix omission is resolved', () => {
  const files = Array.from({ length: 20 }, (_, index) => ({ prefix: index < 16 ? '00BA3' : 'BA3', size: `T${Math.floor(index / 2) + 1}`, side: index % 2 ? 'back' : 'front' }));
  assert.equal(resolvePrefix(files, '00BA3', '00BA3', () => undefined).prefix, '00BA3');
  files[19].size = 'T9';
  assert.equal(resolvePrefix(files, '00BA3', '00BA3', () => undefined).error, 'prefix-ambiguous');
});
test('staging and backups must be outside the productive tree', () => {
  assert.throws(() => assertOutside('C:/assets/stage', 'C:/assets', 'stage'));
  assert.throws(() => assertOutside('C:/assets', 'C:/assets', 'stage'));
  assert.doesNotThrow(() => assertOutside('C:/assets-backup', 'C:/assets', 'stage'));
});
test('the actual Library parser classifies twenty outputs and excludes personalized files', async () => {
  const vite = await createServer({ configFile: false, server: { middlewareMode: true, watch: null } });
  try {
    const { parseDesignAssetFilename } = await vite.ssrLoadModule('/src/domain/design-asset-filename.ts');
    const { createMoldOutputPlan } = await vite.ssrLoadModule('/src/domain/molds-generation.ts');
    const outputs = createMoldOutputPlan('00BA3', { front: { widthPx: 985, heightPx: 1226 }, back: { widthPx: 1245, heightPx: 1801 } });
    assert.equal(outputs.length, 20);
    assert.equal(new Set(outputs.map(spec => spec.fileName)).size, 20);
    for (const spec of outputs) {
      assert.equal(classifyCanonicalFilename(spec.fileName, parseDesignAssetFilename).size, spec.size);
      assert.equal(classifyCanonicalFilename('nom' + spec.fileName, parseDesignAssetFilename), null);
    }
    assert.equal(classifyCanonicalFilename('00BA3_0001_T1-FRENTE.png', parseDesignAssetFilename), null);
  } finally { await vite.close(); }
});
