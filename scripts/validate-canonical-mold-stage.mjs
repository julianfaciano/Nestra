#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const codec = path.join(repo, 'scripts', 'mold-png-codec.py');
const pythonPath = 'C:\\Users\\julian\\AppData\\Local\\Temp\\nestra-psd-reader';
const manifestPath = path.resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Uso: node scripts/validate-canonical-mold-stage.mjs <manifest.json>');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (manifest.mode !== 'full' || manifest.complete !== true || manifest.folders?.length !== 30 || manifest.generated?.length !== 600) {
  throw new Error('Se exige un staging completo de 30 carpetas y 600 PNG.');
}
const server = await createServer({ configFile: false, root: repo, appType: 'custom', server: { middlewareMode: true, watch: null, hmr: false } });
try {
  const [molds, filename] = await Promise.all([
    server.ssrLoadModule('/src/domain/molds-generation.ts'),
    server.ssrLoadModule('/src/domain/design-asset-filename.ts'),
  ]);
  const shared = await server.ssrLoadModule('/src/domain/size-mark-raster.ts');
  const outputs = [];
  const folderByName = new Map(manifest.folders.map(folder => [folder.folder, folder]));
  const masterHashes = [];
  for (const folder of manifest.folders) {
    const planned = molds.createMoldOutputPlan(folder.prefix, {
      front: folder.masters.front,
      back: folder.masters.back,
    });
    if (planned.length !== 20 || planned.some((spec, i) => spec.fileName !== folder.plan[i].fileName ||
      spec.widthPx !== folder.plan[i].widthPx || spec.heightPx !== folder.plan[i].heightPx)) {
      throw new Error(`Grada/naming no coincide en ${folder.folder}`);
    }
    for (const side of ['front', 'back']) {
      const master = folder.masters[side];
      const masterPath = master.sourcePath ?? path.join(folder.absolutePath, master.fileName);
      const bytes = await readFile(masterPath);
      const digest = createHash('sha256').update(bytes).digest('hex');
      if (digest !== master.sha256) throw new Error(`Master cambió: ${folder.folder}/${master.fileName}`);
      masterHashes.push({ folder: folder.folder, source: masterPath, sha256: digest });
    }
    for (const spec of planned) {
      const item = manifest.generated.find(entry => entry.folder === folder.folder && entry.fileName === spec.fileName);
      if (!item || item.widthPx !== spec.widthPx || item.heightPx !== spec.heightPx ||
        filename.parseDesignAssetFilename(spec.fileName)?.size !== spec.size ||
        filename.parseDesignAssetFilename(spec.fileName)?.side !== spec.side) {
        throw new Error(`Parser, conteo o dimensiones incorrectos: ${folder.folder}/${spec.fileName}`);
      }
      const bytes = await readFile(item.stagedPath);
      if (createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw new Error(`Hash staged cambió: ${item.relativePath}`);
      const mask = shared.createSizeMarkGlyph(spec.size);
      outputs.push({
        folder: folder.folder, fileName: spec.fileName, size: spec.size, stagedPath: item.stagedPath,
        masterPath: folder.masters[spec.sourceSide].sourcePath ?? path.join(folder.absolutePath, folder.masters[spec.sourceSide].fileName),
        widthPx: spec.widthPx, heightPx: spec.heightPx,
        placement: item.sizeMark.placement,
        maskWidth: mask.width, maskHeight: mask.height, mask: Buffer.from(mask.data).toString('base64'),
        gapPx: item.sizeMark.gapPx,
      });
    }
  }
  if (folderByName.size !== 30 || outputs.length !== 600 || new Set(outputs.map(item => `${item.folder}/${item.fileName}`)).size !== 600) {
    throw new Error('Cada uno de los 30 diseños debe tener exactamente 20 salidas únicas.');
  }
  const contractPath = path.join(manifest.stageRoot, 'validation-contract.json');
  await writeFile(contractPath, JSON.stringify({ expectedCount: 600, marginPx: shared.SIZE_MARK_MARGIN_PX, outputs }));
  const verified = spawnSync('python', [codec, 'verify', contractPath], {
    encoding: 'utf8', maxBuffer: 1024 * 1024,
    env: { ...process.env, NESTRA_MOLD_PYTHONPATH: pythonPath }, windowsHide: true,
  });
  if (verified.error || verified.status !== 0) throw verified.error ?? new Error(verified.stderr);
  const result = { ...JSON.parse(verified.stdout), folders: folderByName.size, masterSourceHashes: masterHashes,
    markerHeightPx: shared.SIZE_MARK_HEIGHT_PX, color: '#8aff00', parser: 'Nestra parseDesignAssetFilename',
    validatedAt: new Date().toISOString() };
  await writeFile(path.join(manifest.stageRoot, 'validation-report.json'), JSON.stringify(result, null, 2));
  process.stdout.write(`${JSON.stringify({ ...result, masterSourceHashes: undefined })}\n`);
} finally { await server.close(); }
