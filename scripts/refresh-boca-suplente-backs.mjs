// One scoped reconciliation authorized for the current production order.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, copyFile, rename } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { createServer } from 'vite';
import { renderNodeMold } from './mold-node-renderer.mjs';

const manifestPath = path.resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Falta manifest definitivo.');
const original = JSON.parse(await readFile(manifestPath, 'utf8'));
const target = 'Boca/Boca Suplente 2026';
const approvedBackHash = '23f2d489b42fbb1be62c5d766e4a91d051e10ea73eb5ef062e838a7774de3ec7';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const masterPath = (folder, side) => folder.masters[side].sourcePath ?? path.join(folder.absolutePath, folder.masters[side].fileName);
if (!original.complete || original.generated.length !== 600 || original.folders.length !== 30) throw new Error('Stage no completo.');
const authorized = JSON.parse(await readFile(path.join(original.stageRoot, 'current-product-preflight-delta.json'), 'utf8'));
if (authorized.count !== 20 || authorized.changes.some(item => !item.path.startsWith(target + '/'))) throw new Error('Delta autorizado inesperado.');
const knownChanges = new Map(authorized.changes.map(item => [item.path, item.current]));
const checkedCurrent = new Map();
for (const folder of original.folders) {
  for (const side of ['front', 'back']) {
    const bytes = await readFile(masterPath(folder, side));
    const expected = folder.folder === target && side === 'back' ? approvedBackHash : folder.masters[side].sha256;
    if (digest(bytes) !== expected) throw new Error(`Nueva divergencia de master: ${folder.folder}/${side}`);
  }
  for (const item of folder.existingCanonicalFiles) {
    const bytes = await readFile(path.join(original.assetsRoot, ...item.relativePath.split('/')));
    const expected = knownChanges.get(item.relativePath) ?? item.sha256;
    if (digest(bytes) !== expected) throw new Error(`Nueva divergencia productiva: ${item.relativePath}`);
    checkedCurrent.set(item.relativePath, { sha256: expected, bytes: bytes.length });
  }
}
for (const item of original.generated) {
  if (digest(await readFile(item.stagedPath)) !== item.sha256) throw new Error(`Stage cambió: ${item.relativePath}`);
}
const manifest = structuredClone(original);
const folder = manifest.folders.find(item => item.folder === target);
if (!folder) throw new Error('Falta carpeta autorizada.');
const backPath = masterPath(folder, 'back');
const backBytes = await readFile(backPath);
if (backBytes.readUInt32BE(16) !== folder.masters.back.widthPx || backBytes.readUInt32BE(20) !== folder.masters.back.heightPx) throw new Error('El master actual cambió dimensiones.');
folder.masters.back.sha256 = approvedBackHash;
folder.masters.back.bytes = backBytes.length;
folder.existingCanonicalFiles = folder.existingCanonicalFiles.map(item => ({ ...item, ...checkedCurrent.get(item.relativePath) }));
const refreshRoot = path.join(original.stageRoot, 'boca-back-current-master');
await mkdir(refreshRoot); // Never overwrite a previous attempt.
const outputs = [];
const replacements = [];
const server = await createServer({ configFile: false, root: process.cwd(), appType: 'custom', server: { middlewareMode: true, watch: null } });
try {
  const shared = await server.ssrLoadModule('/src/domain/size-mark-raster.ts');
  const metadata = await server.ssrLoadModule('/src/domain/size-mark-metadata.ts');
  const filename = await server.ssrLoadModule('/src/domain/design-asset-filename.ts');
  const specs = folder.plan.filter(spec => spec.side === 'back');
  if (specs.length !== 10 || specs.some(spec => spec.sourceSide !== 'back')) throw new Error('Se requieren sólo los 10 BACK.');
  for (const spec of specs) {
    const old = manifest.generated.find(item => item.folder === target && item.fileName === spec.fileName);
    if (filename.parseDesignAssetFilename(spec.fileName)?.side !== 'back') throw new Error('Parser BACK inválido.');
    const outputPath = path.join(refreshRoot, spec.fileName);
    const sizeMark = renderNodeMold(backPath, spec, outputPath, shared);
    const bytes = await readFile(outputPath);
    const mark = metadata.readSizeMarkPngMetadata(bytes);
    if (mark?.size !== spec.size || mark.height !== 18) throw new Error('Metadata inválida.');
    const mask = shared.createSizeMarkGlyph(spec.size);
    outputs.push({ folder: target, fileName: spec.fileName, size: spec.size, stagedPath: outputPath,
      masterPath: backPath, widthPx: spec.widthPx, heightPx: spec.heightPx, placement: sizeMark.placement,
      maskWidth: mask.width, maskHeight: mask.height, mask: Buffer.from(mask.data).toString('base64'), gapPx: sizeMark.gapPx });
    const next = { ...old, bytes: bytes.length, sha256: digest(bytes), sizeMark };
    replacements.push({ old: structuredClone(old), next, outputPath });
    console.log(`Generado BACK ${spec.size}: ${spec.fileName}`);
  }
  const contractPath = path.join(refreshRoot, 'validation-contract.json');
  await writeFile(contractPath, JSON.stringify({ expectedCount: 10, outputs }));
  const verified = spawnSync('python', ['scripts/mold-png-codec.py', 'verify', contractPath], {
    encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024,
    env: { ...process.env, NESTRA_MOLD_PYTHONPATH: 'C:\\Users\\julian\\AppData\\Local\\Temp\\nestra-psd-reader' },
  });
  if (verified.error || verified.status !== 0) throw verified.error ?? new Error(verified.stderr);
  const report = JSON.parse(verified.stdout);
  if (report.validated !== 10) throw new Error('Validación independiente incompleta.');
  await writeFile(path.join(refreshRoot, 'validation-report.json'), JSON.stringify(report, null, 2));
  // Recheck productive inputs before mutating ONLY these ten staged outputs.
  for (const f of original.folders) {
    for (const side of ['front', 'back']) {
      const expected = f.folder === target && side === 'back' ? approvedBackHash : f.masters[side].sha256;
      if (digest(await readFile(masterPath(f, side))) !== expected) throw new Error(`Master cambió durante refresh: ${f.folder}/${side}`);
    }
    for (const item of f.existingCanonicalFiles) {
      if (digest(await readFile(path.join(original.assetsRoot, ...item.relativePath.split('/')))) !== checkedCurrent.get(item.relativePath).sha256) throw new Error(`Producto cambió durante refresh: ${item.relativePath}`);
    }
  }
  const history = path.join(refreshRoot, 'previous-staged');
  await mkdir(history);
  await copyFile(manifestPath, path.join(refreshRoot, 'manifest-before-refresh.json'));
  for (const item of replacements) await copyFile(item.old.stagedPath, path.join(history, item.old.fileName));
  const updated = [];
  try {
    for (const item of replacements) {
      const temp = item.old.stagedPath + '.refresh.tmp';
      await copyFile(item.outputPath, temp);
      await rename(temp, item.old.stagedPath);
      updated.push(item);
      manifest.generated[manifest.generated.findIndex(output => output.relativePath === item.old.relativePath)] = item.next;
    }
    for (const item of manifest.generated) {
      if (digest(await readFile(item.stagedPath)) !== item.sha256) throw new Error(`Stage final no coincide: ${item.relativePath}`);
    }
    manifest.scopedRefresh = { target, side: 'back', count: 10, preservedCount: 590,
      approvedMasterSha256: approvedBackHash, at: new Date().toISOString(), independentValidation: report };
    const tempManifest = manifestPath + '.refresh.tmp';
    await writeFile(tempManifest, JSON.stringify(manifest, null, 2));
    await rename(tempManifest, manifestPath);
  } catch (error) {
    for (const item of updated.reverse()) await copyFile(path.join(history, item.old.fileName), item.old.stagedPath);
    throw error;
  }
  console.log(JSON.stringify({ regenerated: 10, independentlyValidated: 10, preserved: 590, total: 600, complete: manifest.complete }));
} finally { await server.close(); }
