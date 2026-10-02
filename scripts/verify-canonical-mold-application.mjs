import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';

const [mode, manifestPath, snapshotPath, backupRoot] = process.argv.slice(2);
if (!['before', 'after'].includes(mode) || !manifestPath || !snapshotPath) {
  throw new Error('Uso: node scripts/verify-canonical-mold-application.mjs before|after <manifest> <snapshot> [backup]');
}
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (!manifest.complete || manifest.folders.length !== 30 || manifest.generated.length !== 600) {
  throw new Error('Se requieren exactamente 30 diseños/600 PNG completos.');
}
const allowed = new Map(manifest.generated.map(item => [item.relativePath, item]));
const protectedFolders = manifest.folders.map(folder => `${folder.folder}/`);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function inventory(directory, prefix = '') {
  const entries = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const relativePath = prefix + item.name;
    if (item.isSymbolicLink()) throw new Error(`No se recorre un enlace: ${relativePath}`);
    if (item.isDirectory()) entries.push(...await inventory(path.join(directory, item.name), relativePath + '/'));
    else if (item.isFile()) {
      const source = path.join(directory, item.name);
      const info = await stat(source);
      const protectedInScope = !allowed.has(relativePath) && protectedFolders.some(folder => relativePath.startsWith(folder));
      entries.push({ relativePath, size: info.size, mtimeMs: info.mtimeMs,
        ...(protectedInScope ? { sha256: digest(await readFile(source)) } : {}) });
    }
  }
  return entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}
const current = await inventory(manifest.assetsRoot);
if (mode === 'before') {
  for (const folder of manifest.folders) {
    if (folder.existingCanonicalFiles.length !== 20 || folder.existingCanonicalFiles.some(item => !allowed.has(item.relativePath))) {
      throw new Error('Esta aplicación sólo admite reemplazar los mismos 600 nombres.');
    }
  }
  await writeFile(snapshotPath, JSON.stringify({ assetsRoot: manifest.assetsRoot, files: current }, null, 2));
  console.log(JSON.stringify({ files: current.length, replaceCount: allowed.size, protectedHashed: current.filter(file => file.sha256).length }));
} else {
  if (!backupRoot) throw new Error('Falta backup para postflight.');
  const previous = JSON.parse(await readFile(snapshotPath, 'utf8'));
  if (previous.assetsRoot !== manifest.assetsRoot || JSON.stringify(previous.files.map(item => item.relativePath)) !== JSON.stringify(current.map(item => item.relativePath))) {
    throw new Error('Cambió el conjunto de archivos de la biblioteca.');
  }
  const originalByPath = new Map(previous.files.map(item => [item.relativePath, item]));
  for (const file of current) {
    const original = originalByPath.get(file.relativePath);
    if (!allowed.has(file.relativePath) && (file.size !== original.size || file.mtimeMs !== original.mtimeMs || file.sha256 !== original.sha256)) {
      throw new Error(`Archivo protegido/fuera de alcance cambió: ${file.relativePath}`);
    }
  }
  const backups = JSON.parse(await readFile(path.join(backupRoot, 'manifest-backups-verified.json'), 'utf8'));
  if (backups.backupCount !== 600 || new Set(backups.backups.map(item => item.relativePath)).size !== 600) throw new Error('Backup sin cobertura exacta de 600.');
  for (const item of backups.backups) {
    const bytes = await readFile(path.join(backupRoot, 'originals', ...item.relativePath.split('/')));
    if (digest(bytes) !== item.sha256) throw new Error(`Backup corrupto: ${item.relativePath}`);
  }
  for (const item of manifest.generated) {
    const bytes = await readFile(path.join(manifest.assetsRoot, ...item.relativePath.split('/')));
    if (digest(bytes) !== item.sha256) throw new Error(`Producto no coincide con staging: ${item.relativePath}`);
  }
  const root = path.join(backupRoot, 'postflight');
  await mkdir(root, { recursive: true });
  const productManifest = { ...manifest, stageRoot: root,
    generated: manifest.generated.map(item => ({ ...item, stagedPath: path.join(manifest.assetsRoot, ...item.relativePath.split('/')) })) };
  await writeFile(path.join(root, 'product-validation-manifest.json'), JSON.stringify(productManifest, null, 2));
  const result = { count: 600, backupVerified: 600, productHashesMatchStaging: true,
    protectedHashed: current.filter(file => file.sha256).length, outsideScopeUnchanged: current.length - 600,
    unexpectedFiles: 0, productManifest: path.join(root, 'product-validation-manifest.json') };
  await writeFile(path.join(root, 'scope-and-hash-report.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
