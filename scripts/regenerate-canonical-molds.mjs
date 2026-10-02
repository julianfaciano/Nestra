#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { renderNodeMold } from './mold-node-renderer.mjs';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_ASSETS_ROOT = 'C:\\Users\\julian\\Documents\\.fanaticotas';
const SAMPLE_FOLDERS = [
  'Argentina/Argentina 2026 Messi',
  'Boca/Boca 2026',
  'Mafalda',
];
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_PNG_BYTES = 32 * 1024 * 1024;
const MAX_PIXELS = 16_000_000;

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--help') return { help: true };
    if (!arg.startsWith('--')) throw new Error(`Argumento inesperado: ${arg}`);
    const key = arg.slice(2);
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`Falta el valor de --${key}.`);
    values.set(key, value);
  }
  return Object.fromEntries(values);
}

function help() {
  process.stdout.write([
    'Regeneración canónica desde masters limpios con el renderer compartido de /Moldes.',
    '  node --experimental-strip-types scripts/regenerate-canonical-molds.mjs --mode sample --stage-dir <temporal>',
    '  node --experimental-strip-types scripts/regenerate-canonical-molds.mjs --mode full --stage-dir <temporal>',
    '  node --experimental-strip-types scripts/regenerate-canonical-molds.mjs --mode full --resume-stage <staging-incompleto>',
    '  node --experimental-strip-types scripts/regenerate-canonical-molds.mjs --mode apply --manifest <manifest.json> --backup-dir <nuevo-directorio>',
    'Opcionales para sample/full: --assets-root <.fanaticotas> (Node + Python/Pillow; sin navegador).',
    'sample/full sólo generan archivos en stage-dir. apply respalda todos los canónicos de las carpetas completas antes de reemplazarlos.',
  ].join('\n') + '\n');
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertOutside(child, parent, label) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error(`${label} debe quedar fuera del árbol productivo: ${child}`);
  }
}

function normalizeRelative(value) {
  return value.split(path.sep).join('/');
}

function pngDimensions(bytes, label) {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`${label} no tiene una firma PNG válida.`);
  }
  const widthPx = bytes.readUInt32BE(16);
  const heightPx = bytes.readUInt32BE(20);
  if (!widthPx || !heightPx || widthPx * heightPx > MAX_PIXELS) {
    throw new Error(`${label} tiene dimensiones inválidas o supera 16 MP.`);
  }
  return { widthPx, heightPx };
}

async function loadDomainModules(vite) {
  const [molds, filenames] = await Promise.all([
    vite.ssrLoadModule('/src/domain/molds-generation.ts'),
    vite.ssrLoadModule('/src/domain/design-asset-filename.ts'),
  ]);
  return {
    createMoldOutputPlan: molds.createMoldOutputPlan,
    validateMoldPrefix: molds.validateMoldPrefix,
    parseDesignAssetFilename: filenames.parseDesignAssetFilename,
  };
}

function classifyCanonicalFilename(fileName, parseDesignAssetFilename) {
  if (!/\.png$/i.test(fileName) || /nom/i.test(fileName)) return null;
  const parsed = parseDesignAssetFilename(fileName);
  if (!parsed) return null;
  const legacy = /^([^\s\\/]+)_(\d{4})_T(10|[1-9])-(FRENTE|DORSO)\.png$/i.exec(fileName);
  const sizeNumber = Number(String(parsed.size).slice(1));
  const side = parsed.side;
  const expectedSequence = (sizeNumber - 1) * 2 + (side === 'back' ? 1 : 0);
  if (legacy && Number(legacy[2]) !== expectedSequence) return null;
  return {
    fileName,
    prefix: legacy?.[1] ?? parsed.designName ?? null,
    size: parsed.size,
    side,
  };
}

function resolvePrefix(canonicalFiles, frontStem, backStem, validateMoldPrefix) {
  const counts = new Map();
  for (const file of canonicalFiles) {
    if (!file.prefix) continue;
    counts.set(file.prefix, (counts.get(file.prefix) ?? 0) + 1);
  }
  const candidates = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  let prefix;
  let source;
  if (candidates.length === 1) {
    [prefix] = candidates[0];
    source = 'unique-canonical-prefix';
  } else if (candidates.length === 0) {
    if (frontStem && frontStem === backStem) {
      prefix = frontStem;
      source = 'matching-master-stems';
    }
  } else if (frontStem === backStem && candidates.length === 2 && frontStem.startsWith('00') &&
      candidates.some(([candidate, count]) => candidate === frontStem && count === 16) &&
      candidates.some(([candidate, count]) => candidate === frontStem.slice(2) && count === 4) &&
      canonicalFiles.length === 20 && new Set(canonicalFiles.map(file => `${file.size}/${file.side}`)).size === 20 &&
      canonicalFiles.every(file => file.prefix === (Number(file.size.slice(1)) <= 8 ? frontStem : frontStem.slice(2)))) {
    // Verified legacy pattern: both masters + T1–T8 agree, T9–T10 only omit 00.
    prefix = frontStem;
    source = 'matching-masters-and-complete-T1-T8-prefix; T9-T10-legacy-00-omission';
  }
  if (!prefix) return { error: 'prefix-ambiguous', candidates };
  const validationError = validateMoldPrefix(prefix);
  if (validationError) return { error: 'prefix-invalid', detail: validationError, candidates };
  return { prefix, source, candidates };
}

async function walkProductTree(root, parseDesignAssetFilename, requestedFolders) {
  const directories = [];
  const ancestors = requestedFolders && new Set(['.', ...requestedFolders.flatMap(folder => {
    const pieces = folder.split('/');
    return pieces.slice(1).map((_, index) => pieces.slice(0, index + 1).join('/'));
  })]);
  async function walk(directory) {
    const relative = normalizeRelative(path.relative(root, directory)) || '.';
    const isRequested = !requestedFolders || requestedFolders.includes(relative);
    if (requestedFolders && !isRequested && !ancestors.has(relative)) return;
    const entries = await readdir(directory, { withFileTypes: true });
    const fileNames = isRequested ? entries.filter(entry => entry.isFile()).map(entry => entry.name) : [];
    const frontMasters = fileNames.filter(name => /\(F\)\.png$/i.test(name));
    const backMasters = fileNames.filter(name => /\(D\)\.png$/i.test(name));
    const canonicalFiles = fileNames
      .map(fileName => classifyCanonicalFilename(fileName, parseDesignAssetFilename))
      .filter(Boolean);
    if (frontMasters.length || backMasters.length || canonicalFiles.length) {
      directories.push({ directory, fileNames, frontMasters, backMasters, canonicalFiles });
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) await walk(path.join(directory, entry.name));
    }
  }
  await walk(root);
  return directories;
}

async function discoverPlans(root, modules, recoveredSources = [], requestedFolders) {
  const directories = await walkProductTree(root, modules.parseDesignAssetFilename, requestedFolders);
  const folders = [];
  const exceptions = [];
  for (const item of directories) {
    const folder = normalizeRelative(path.relative(root, item.directory));
    const recovered = recoveredSources.find(source => source.folder === folder);
    if (recovered) {
      if (item.frontMasters.length || item.backMasters.length) throw new Error(`Recovered source conflicts with existing masters: ${folder}`);
      item.frontMasters = [path.basename(recovered.front)];
      item.backMasters = [path.basename(recovered.back)];
      if (sha256(await readFile(recovered.sourceDocument)) !== recovered.sourceDocumentSha256) throw new Error('PSD source changed');
    }
    const { frontMasters, backMasters, canonicalFiles } = item;
    if (frontMasters.length !== 1 || backMasters.length !== 1) {
      const reason = frontMasters.length > 1 || backMasters.length > 1
        ? 'ambiguous-master-files'
        : frontMasters.length === 0 && backMasters.length === 0
          ? 'missing-front-and-back-masters'
          : frontMasters.length === 0 ? 'missing-front-master' : 'missing-back-master';
      exceptions.push({ folder, reason, frontMasters, backMasters, canonicalFileCount: canonicalFiles.length });
      continue;
    }

    const frontPath = recovered?.front ?? path.join(item.directory, frontMasters[0]);
    const backPath = recovered?.back ?? path.join(item.directory, backMasters[0]);
    let frontBytes;
    let backBytes;
    let front;
    let back;
    try {
      [frontBytes, backBytes] = await Promise.all([readFile(frontPath), readFile(backPath)]);
      if (frontBytes.length > MAX_PNG_BYTES || backBytes.length > MAX_PNG_BYTES) {
        throw new Error('Cada master debe tener un máximo de 32 MiB.');
      }
      front = { ...pngDimensions(frontBytes, frontMasters[0]), fileName: frontMasters[0], sha256: sha256(frontBytes), bytes: frontBytes.length };
      back = { ...pngDimensions(backBytes, backMasters[0]), fileName: backMasters[0], sha256: sha256(backBytes), bytes: backBytes.length };
      if (recovered) {
        front.sourcePath = frontPath;
        back.sourcePath = backPath;
      }
    } catch (error) {
      exceptions.push({ folder, reason: 'invalid-master-png', detail: String(error), frontMasters, backMasters });
      continue;
    }

    const frontStem = front.fileName.replace(/\s*\(F\)\.png$/i, '').trim();
    const backStem = back.fileName.replace(/\s*\(D\)\.png$/i, '').trim();
    const resolution = resolvePrefix(canonicalFiles, frontStem, backStem, modules.validateMoldPrefix);
    if (!resolution.prefix) {
      exceptions.push({
        folder, reason: resolution.error, detail: resolution.detail, candidates: resolution.candidates,
        frontMaster: front.fileName, backMaster: back.fileName, canonicalFileCount: canonicalFiles.length,
      });
      continue;
    }

    let plan;
    try {
      plan = modules.createMoldOutputPlan(resolution.prefix, {
        front: { widthPx: front.widthPx, heightPx: front.heightPx },
        back: { widthPx: back.widthPx, heightPx: back.heightPx },
      });
      if (plan.length !== 20) throw new Error(`La grada devolvió ${plan.length} archivos, se esperaban 20.`);
    } catch (error) {
      exceptions.push({ folder, reason: 'mold-output-plan-failed', detail: String(error), frontMaster: front.fileName, backMaster: back.fileName });
      continue;
    }

    const existingCanonicalFiles = [];
    for (const file of canonicalFiles) {
      const absolutePath = path.join(item.directory, file.fileName);
      const bytes = await readFile(absolutePath);
      existingCanonicalFiles.push({
        fileName: file.fileName,
        relativePath: normalizeRelative(path.relative(root, absolutePath)),
        sha256: sha256(bytes),
        bytes: bytes.length,
      });
    }

    folders.push({
      id: `folder-${folders.length}`,
      folder,
      absolutePath: item.directory,
      prefix: resolution.prefix,
      prefixSource: resolution.source,
      prefixCandidates: resolution.candidates,
      masters: { front, back },
      recoveredSource: recovered,
      plan: plan.map(spec => ({
        size: spec.size,
        side: spec.side,
        sourceSide: spec.sourceSide,
        fileName: spec.fileName,
        widthPx: spec.widthPx,
        heightPx: spec.heightPx,
      })),
      existingCanonicalFiles,
    });
  }
  return { directories, folders, exceptions };
}

async function startStage(args, mode) {
  const assetsRoot = path.resolve(args['assets-root'] ?? DEFAULT_ASSETS_ROOT);
  const resuming = Boolean(args['resume-stage']);
  if (resuming && (mode !== 'full' || args['stage-dir'])) throw new Error('--resume-stage sólo se usa con --mode full y sin --stage-dir.');
  if (!resuming && !args['stage-dir']) throw new Error(`${mode} requiere --stage-dir.`);
  const stageRoot = path.resolve(resuming ? args['resume-stage'] : args['stage-dir']);
  assertOutside(stageRoot, assetsRoot, 'stage-dir');
  if (resuming) {
    const progressPath = path.join(stageRoot, 'manifest-progress.json');
    const progress = JSON.parse(await readFile(progressPath, 'utf8'));
    if (progress.schemaVersion !== 1 || progress.mode !== 'full' || progress.complete !== false ||
        path.resolve(progress.stageRoot) !== stageRoot || path.resolve(progress.assetsRoot) !== assetsRoot ||
        progress.folders?.length !== 30 || progress.expectedPngCount !== 600 ||
        progress.generated?.length > progress.expectedPngCount || progress.errors?.length) {
      throw new Error('El manifest-progress no corresponde a un staging full reanudable de 30 diseños/600 PNG sin errores.');
    }
  } else {
    await mkdir(stageRoot); // exclusive: never reuse partial outputs
  }
  const vite = await createServer({ configFile: false, root: PROJECT_ROOT, appType: 'custom', server: { middlewareMode: true, watch: null } });
  try {
    const modules = await loadDomainModules(vite);
    const shared = await vite.ssrLoadModule('/src/domain/size-mark-raster.ts');
    let manifest;
    let folders;
    const orphanedOutputs = [];
    if (resuming) {
      manifest = JSON.parse(await readFile(path.join(stageRoot, 'manifest-progress.json'), 'utf8'));
      if (!Array.isArray(manifest.generated)) throw new Error('El manifest-progress no tiene lista generated.');
      folders = manifest.folders;
      const folderByName = new Map(manifest.folders.map(folder => [folder.folder, folder]));
      if (folderByName.size !== manifest.folders.length || manifest.folders.some(folder => folder.plan?.length !== 20)) {
        throw new Error('El staging contiene carpetas/planes duplicados o incompletos.');
      }
      const generatedByKey = new Map();
      for (const item of manifest.generated) {
        const folder = folderByName.get(item.folder);
        const spec = folder?.plan.find(entry => entry.fileName === item.fileName);
        const key = `${item.folder}/${item.fileName}`;
        if (!spec || generatedByKey.has(key) || item.relativePath !== key ||
            path.resolve(item.stagedPath) !== path.resolve(stageRoot, 'files', ...key.split('/')) ||
            item.size !== spec.size || item.side !== spec.side ||
            item.widthPx !== spec.widthPx || item.heightPx !== spec.heightPx) {
          throw new Error(`Registro staged duplicado/inconsistente: ${key}`);
        }
        const bytes = await readFile(item.stagedPath);
        const dimensions = pngDimensions(bytes, item.fileName);
        if (sha256(bytes) !== item.sha256 || bytes.length !== item.bytes ||
            dimensions.widthPx !== spec.widthPx || dimensions.heightPx !== spec.heightPx) {
          throw new Error(`PNG staged registrado no coincide; no se modifica: ${key}`);
        }
        generatedByKey.set(key, item);
      }
      for (const folder of manifest.folders) {
        for (const side of ['front', 'back']) {
          const master = folder.masters[side];
          const source = master.sourcePath ?? path.join(folder.absolutePath, master.fileName);
          if (sha256(await readFile(source)) !== master.sha256) throw new Error(`Master cambió; no se reanuda: ${folder.folder}/${master.fileName}`);
        }
        for (const spec of folder.plan) {
          const key = `${folder.folder}/${spec.fileName}`;
          if (generatedByKey.has(key)) continue;
          const stagedPath = path.resolve(stageRoot, 'files', ...key.split('/'));
          try {
            await stat(stagedPath);
            orphanedOutputs.push({ folder, spec, key, stagedPath });
          } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
          }
        }
      }
      const reconciliation = [];
      for (const orphan of orphanedOutputs) {
        const { folder, spec, key, stagedPath } = orphan;
        const verificationPath = path.join(stageRoot, 'resume-verification', `${key.replace(/[\\/]/g, '__')}.${process.pid}.expected.png`);
        await mkdir(path.dirname(verificationPath), { recursive: true });
        const master = folder.masters[spec.sourceSide];
        const sizeMark = renderNodeMold(master.sourcePath ?? path.join(folder.absolutePath, master.fileName), spec, verificationPath, shared);
        const actualBytes = await readFile(stagedPath);
        const expectedBytes = await readFile(verificationPath);
        const dimensions = pngDimensions(actualBytes, spec.fileName);
        if (sha256(actualBytes) !== sha256(expectedBytes) || dimensions.widthPx !== spec.widthPx || dimensions.heightPx !== spec.heightPx) {
          throw new Error(`PNG existente sin registro no coincide con la salida determinística; se conserva intacto: ${key}`);
        }
        const item = { folder: folder.folder, fileName: spec.fileName, relativePath: key, stagedPath,
          size: spec.size, side: spec.side, ...dimensions, bytes: actualBytes.length, sha256: sha256(actualBytes), sizeMark };
        manifest.generated.push(item);
        generatedByKey.set(key, item);
        reconciliation.push({ relativePath: key, sha256: item.sha256, verifiedAgainst: verificationPath, byteIdentical: true });
        manifest.resumeReconciliation = reconciliation;
        await writeFile(path.join(stageRoot, 'manifest-progress.json'), JSON.stringify(manifest, null, 2));
      }
      process.stdout.write(`Resume verificado: ${generatedByKey.size}/${manifest.expectedPngCount}; ${reconciliation.length} PNG huérfanos validados/adoptados sin sobrescribir.\n`);
    } else {
    const { PRODUCTION_ORDER } = await vite.ssrLoadModule('/src/test/production-order-2026-10-01.ts');
    const recoveredSources = args.sources ? JSON.parse(await readFile(args.sources, 'utf8')) : [];
    const requestedFolders = args['only-folders'] ? [...new Set(args['only-folders'].split('|').filter(Boolean))] : undefined;
    if (args['only-folders'] && requestedFolders.length !== args['only-folders'].split('|').length) throw new Error('--only-folders contiene rutas duplicadas/vacías.');
    const discovery = await discoverPlans(assetsRoot, modules, recoveredSources, requestedFolders);
    const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const orderNames = PRODUCTION_ORDER.split(';').map(line => line.trim().split(/\s+t\d+=/i)[0]).filter(Boolean);
    const orderCoverage = orderNames.map(design => {
      const match = [...discovery.folders, ...discovery.exceptions].filter(folder => normalize(path.posix.basename(folder.folder)) === normalize(design));
      return { design, status: match.length === 1 ? (match[0].reason ?? 'regenerable') : 'unresolved-folder', folder: match[0]?.folder };
    });
    const garmentCount = [...PRODUCTION_ORDER.matchAll(/t\d+=(\d+)/gi)].reduce((sum, match) => sum + Number(match[1]), 0);
    if (garmentCount !== 641) throw new Error(`El fixture tiene ${garmentCount} prendas, se esperaban 641.`);
    const exceptions = discovery.exceptions.map(item => ({ ...item, usedByOrder: orderCoverage.some(row => row.folder === item.folder) }));
    folders = mode === 'sample' ? SAMPLE_FOLDERS.map(name => {
      const folder = discovery.folders.find(item => item.folder === name);
      if (!folder) throw new Error(`Sample no regenerable: ${name}`);
      return folder;
    }) : discovery.folders.filter(folder => !args['only-folders'] || args['only-folders'].split('|').includes(folder.folder));
    if (requestedFolders && (folders.length !== requestedFolders.length || requestedFolders.some(name => !folders.some(folder => folder.folder === name)))) {
      const missing = requestedFolders.filter(name => !folders.some(folder => folder.folder === name));
      throw new Error(`Faltan carpetas objetivo con par de masters y prefijo resoluble: ${missing.join(', ')}`);
    }
    manifest = {
      schemaVersion: 1, generatedAt: new Date().toISOString(), mode, assetsRoot, stageRoot,
      discoveredFolders: discovery.directories.length,
      foldersWithMasterPairs: discovery.directories.filter(item => item.frontMasters.length === 1 && item.backMasters.length === 1).length,
      validFolderCount: discovery.folders.length, selectedFolderCount: folders.length, expectedPngCount: folders.length * 20,
      discoveryExceptions: exceptions, order: { garmentCount, pieces: garmentCount * 2, orderCoverage,
        replacements: { count: 2, status: 'Identity not present in order fixture; personalized PNGs intentionally untouched' } },
      folders, complete: false, generated: [], errors: [],
    };
    await writeFile(path.join(stageRoot, 'manifest-started.json'), JSON.stringify(manifest, null, 2));
    process.stdout.write(JSON.stringify({ masterPairs: manifest.foldersWithMasterPairs, validFolders: discovery.folders.length, exceptions: exceptions.length, orderExceptions: orderCoverage.filter(row => row.status !== 'regenerable') }) + '\n');
    }
    const generatedKeys = new Set(manifest.generated.map(item => `${item.folder}/${item.fileName}`));
    for (const folder of folders) {
      for (const spec of folder.plan) {
        const key = `${folder.folder}/${spec.fileName}`;
        if (generatedKeys.has(key)) continue;
        const relativePath = normalizeRelative(path.join(folder.folder, spec.fileName));
        const stagedPath = path.join(stageRoot, 'files', relativePath);
        try {
          await stat(stagedPath);
          throw new Error(`Hay un PNG staged sin registro; no se sobrescribe: ${relativePath}`);
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
        await mkdir(path.dirname(stagedPath), { recursive: true });
        try {
          const parsed = modules.parseDesignAssetFilename(spec.fileName);
          if (parsed?.size !== spec.size || parsed?.side !== spec.side) throw new Error('Parser mismatch');
          const master = folder.masters[spec.sourceSide];
          const sizeMark = renderNodeMold(master.sourcePath ?? path.join(folder.absolutePath, master.fileName), spec, stagedPath, shared);
          const bytes = await readFile(stagedPath);
          const dimensions = pngDimensions(bytes, spec.fileName);
          if (bytes.length > MAX_PNG_BYTES || dimensions.widthPx !== spec.widthPx || dimensions.heightPx !== spec.heightPx) throw new Error('PNG limits/dimensions mismatch');
          manifest.generated.push({ folder: folder.folder, fileName: spec.fileName, relativePath, stagedPath, size: spec.size, side: spec.side,
            ...dimensions, bytes: bytes.length, sha256: sha256(bytes), sizeMark });
          generatedKeys.add(key);
          if (resuming) await writeFile(path.join(stageRoot, 'manifest-progress.json'), JSON.stringify(manifest, null, 2));
        } catch (error) {
          manifest.errors.push({ folder: folder.folder, fileName: spec.fileName, error: String(error) });
          if (resuming) await writeFile(path.join(stageRoot, 'manifest-progress.json'), JSON.stringify(manifest, null, 2));
        }
      }
      for (const master of Object.values(folder.masters)) {
        if (sha256(await readFile(master.sourcePath ?? path.join(folder.absolutePath, master.fileName))) !== master.sha256) throw new Error('Master changed during staging');
      }
      process.stdout.write(`Staged ${manifest.generated.length}/${manifest.expectedPngCount}: ${folder.folder}\n`);
      await writeFile(path.join(stageRoot, 'manifest-progress.json'), JSON.stringify(manifest, null, 2));
    }
    manifest.complete = manifest.generated.length === manifest.expectedPngCount && manifest.errors.length === 0;
    manifest.generatedCount = manifest.generated.length;
    manifest.finishedAt = new Date().toISOString();
    await writeFile(path.join(stageRoot, 'manifest.json'), JSON.stringify(manifest, null, 2));
    if (!manifest.complete) throw new Error(`Stage incompleto: ${manifest.errors.length} errores. Ver manifest.`);
    process.stdout.write(`Staging completo: ${manifest.generatedCount}; ${path.join(stageRoot, 'manifest.json')}\n`);
  } finally { await vite.close(); }
}

async function currentCanonicalFiles(directory, parseDesignAssetFilename) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const classified = classifyCanonicalFilename(entry.name, parseDesignAssetFilename);
    if (classified) files.push(entry.name);
  }
  return files.sort((a, b) => a.localeCompare(b));
}

async function applyManifest(args) {
  const root = path.resolve(args['assets-root'] ?? DEFAULT_ASSETS_ROOT);
  const manifestPath = path.resolve(args.manifest ?? '');
  const backupRoot = path.resolve(args['backup-dir'] ?? '');
  if (!args.manifest || !args['backup-dir']) throw new Error('apply requiere --manifest y --backup-dir.');
  assertOutside(backupRoot, root, 'backup-dir');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.mode !== 'full' || manifest.complete !== true || path.resolve(manifest.assetsRoot) !== root) {
    throw new Error('El manifest no es un stage completo del lote full para esta biblioteca.');
  }
  if (!Array.isArray(manifest.folders) || manifest.folders.length === 0 || manifest.generated?.length !== manifest.folders.length * 20) {
    throw new Error('El manifest no contiene 20 salidas completas por carpeta.');
  }
  assertOutside(manifest.stageRoot, root, 'stageRoot');
  try {
    await stat(backupRoot);
    throw new Error(`El directorio de backup ya existe; usá uno nuevo: ${backupRoot}`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const vite = await createServer({ configFile: false, root: PROJECT_ROOT, appType: 'custom', server: { middlewareMode: true } });
  let modules;
  try {
    modules = await loadDomainModules(vite);
  } finally {
    await vite.close();
  }

  const folderWork = [];
  for (const folder of manifest.folders) {
    const absolute = path.resolve(root, ...folder.folder.split('/'));
    const withinRoot = path.relative(root, absolute);
    if (!withinRoot || withinRoot.startsWith('..') || path.isAbsolute(withinRoot)) throw new Error('Folder outside productive root');
    if (folder.recoveredSource && sha256(await readFile(folder.recoveredSource.sourceDocument)) !== folder.recoveredSource.sourceDocumentSha256) throw new Error('PSD source changed');
    const currentNames = await currentCanonicalFiles(absolute, modules.parseDesignAssetFilename);
    const expectedNames = folder.plan.map(spec => spec.fileName);
    const oldFiles = folder.existingCanonicalFiles;
    const oldNames = oldFiles.map(file => file.fileName).sort((a, b) => a.localeCompare(b));
    if (JSON.stringify(currentNames) !== JSON.stringify(oldNames)) {
      throw new Error(`Cambió el conjunto de PNG canónicos desde el stage en ${folder.folder}; no se aplica.`);
    }
    for (const item of oldFiles) {
      const source = path.resolve(root, ...item.relativePath.split('/'));
      const bytes = await readFile(source);
      if (sha256(bytes) !== item.sha256) throw new Error(`Cambió un PNG canónico desde el stage: ${item.relativePath}`);
    }
    for (const side of ['front', 'back']) {
      const master = folder.masters[side];
      const bytes = await readFile(master.sourcePath ?? path.join(absolute, master.fileName));
      if (sha256(bytes) !== master.sha256) throw new Error(`Cambió un master desde el stage: ${folder.folder}/${master.fileName}`);
    }
    const outputs = manifest.generated.filter(entry => entry.folder === folder.folder);
    if (outputs.length !== 20) throw new Error(`El manifest no tiene exactamente 20 PNG para ${folder.folder}.`);
    for (const output of outputs) {
      if (path.basename(output.fileName) !== output.fileName || path.resolve(output.stagedPath) !== path.resolve(manifest.stageRoot, 'files', folder.folder, output.fileName)) throw new Error('Unsafe output path');
      const spec = folder.plan.find(item => item.fileName === output.fileName);
      if (!spec || output.widthPx !== spec.widthPx || output.heightPx !== spec.heightPx) throw new Error(`Plan/dimensiones inconsistentes: ${folder.folder}/${output.fileName}`);
      const bytes = await readFile(output.stagedPath);
      if (sha256(bytes) !== output.sha256) throw new Error(`Cambió un PNG staged: ${output.relativePath}`);
      const dimensions = pngDimensions(bytes, output.fileName);
      if (dimensions.widthPx !== spec.widthPx || dimensions.heightPx !== spec.heightPx) throw new Error(`Dimensiones inválidas en ${output.fileName}`);
      if (modules.parseDesignAssetFilename(output.fileName)?.size !== spec.size || modules.parseDesignAssetFilename(output.fileName)?.side !== spec.side) {
        throw new Error(`Biblioteca no reconoce ${output.fileName}.`);
      }
    }
    const expectedLower = new Set(expectedNames.map(name => name.toLowerCase()));
    const staleFiles = oldFiles.filter(file => !expectedLower.has(file.fileName.toLowerCase()));
    folderWork.push({ folder, absolute, oldFiles, outputs, staleFiles });
  }

  const backups = [];
  const changed = [];
  const deleted = [];
  await mkdir(path.join(backupRoot, 'originals'), { recursive: true });
  await writeFile(path.join(backupRoot, 'manifest-before.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  try {
    for (const work of folderWork) {
      for (const item of work.oldFiles) {
        const source = path.resolve(root, ...item.relativePath.split('/'));
        const backup = path.join(backupRoot, 'originals', ...item.relativePath.split('/'));
        await mkdir(path.dirname(backup), { recursive: true });
        await copyFile(source, backup);
        if (sha256(await readFile(backup)) !== item.sha256) throw new Error(`Backup no coincide: ${item.relativePath}`);
        backups.push({ source, backup, relativePath: item.relativePath, sha256: item.sha256 });
      }
    }
    await writeFile(path.join(backupRoot, 'manifest-backups-verified.json'), `${JSON.stringify({ backupRoot, backupCount: backups.length, backups: backups.map(({ relativePath, sha256: digest }) => ({ relativePath, sha256: digest })) }, null, 2)}\n`, 'utf8');

    for (const work of folderWork) {
      for (const output of work.outputs) {
        const destination = path.join(work.absolute, output.fileName);
        const tempPath = `${destination}.nestra-regenerate-${process.pid}.tmp`;
        await copyFile(output.stagedPath, tempPath);
        await rename(tempPath, destination);
        changed.push({ destination, relativePath: output.relativePath, original: work.oldFiles.find(item => item.fileName.toLowerCase() === output.fileName.toLowerCase()) });
        if (sha256(await readFile(destination)) !== output.sha256) throw new Error(`La salida aplicada no coincide: ${output.relativePath}`);
      }
    }
    for (const work of folderWork) {
      for (const item of work.staleFiles) {
        const destination = path.resolve(root, ...item.relativePath.split('/'));
        await unlink(destination);
        deleted.push({ destination, item });
      }
    }
    for (const work of folderWork) {
      const actualNames = await currentCanonicalFiles(work.absolute, modules.parseDesignAssetFilename);
      const expected = work.folder.plan.map(spec => spec.fileName).sort((a, b) => a.localeCompare(b));
      if (JSON.stringify(actualNames) !== JSON.stringify(expected)) throw new Error(`El postflight no encontró exactamente 20 canónicos en ${work.folder.folder}.`);
      for (const side of ['front', 'back']) {
        const master = work.folder.masters[side];
        if (sha256(await readFile(master.sourcePath ?? path.join(work.absolute, master.fileName))) !== master.sha256) throw new Error(`El master cambió durante apply: ${work.folder.folder}/${master.fileName}`);
      }
      if (work.folder.recoveredSource && sha256(await readFile(work.folder.recoveredSource.sourceDocument)) !== work.folder.recoveredSource.sourceDocumentSha256) throw new Error('PSD changed during apply');
    }
    const applied = {
      ...manifest,
      appliedAt: new Date().toISOString(),
      backupRoot,
      backupCount: backups.length,
      replacedOrCreatedCount: changed.length,
      staleCanonicalRemovedCount: deleted.length,
      staleCanonicalRemoved: deleted.map(item => item.item.relativePath),
      postflight: '20 parser-recognized canonical PNG per processed folder; all master hashes unchanged.',
    };
    await writeFile(path.join(backupRoot, 'manifest-applied.json'), `${JSON.stringify(applied, null, 2)}\n`, 'utf8');
  } catch (error) {
    for (const item of deleted.reverse()) {
      const backup = backups.find(entry => entry.relativePath === item.item.relativePath);
      if (!backup) continue;
      const tempPath = `${item.destination}.nestra-rollback-${process.pid}.tmp`;
      await copyFile(backup.backup, tempPath);
      await rename(tempPath, item.destination);
    }
    for (const item of changed.reverse()) {
      const original = item.original && backups.find(entry => entry.relativePath === item.original.relativePath);
      if (original) {
        const tempPath = `${item.destination}.nestra-rollback-${process.pid}.tmp`;
        await copyFile(original.backup, tempPath);
        await rename(tempPath, item.destination);
      } else {
        await rm(item.destination, { force: true });
      }
    }
    throw error;
  }
  process.stdout.write(`Aplicación completa: ${folderWork.length} diseños, ${changed.length} PNG regenerados, ${deleted.length} canónicos de prefijos anteriores retirados; ${backups.length} backups verificados.\nManifest aplicado: ${path.join(backupRoot, 'manifest-applied.json')}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return help();
  if (args.mode === 'sample' || args.mode === 'full') return startStage(args, args.mode);
  if (args.mode === 'apply') return applyManifest(args);
  throw new Error('Indicá --mode sample, full o apply.');
}

export { resolvePrefix, classifyCanonicalFilename, pngDimensions, assertOutside };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
