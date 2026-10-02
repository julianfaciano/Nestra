#!/usr/bin/env node
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const codec = path.join(repo, 'scripts', 'mold-png-codec.py');
const pythonPath = 'C:\\Users\\julian\\AppData\\Local\\Temp\\nestra-psd-reader';
const manifestPath = path.resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Uso: node scripts/prepare-imprenta2-marker-probes.mjs <manifest-completo>');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (manifest.complete !== true || manifest.generated?.length !== 600) throw new Error('Se requiere el staging completo de 600 PNG.');

const requested = process.argv[3] ? JSON.parse(await readFile(process.argv[3], 'utf8')) : [
  ['Argentina/Argentina 2026 Messi', 'ARGM_0000s_0000_T1-FRENTE.png'],
  ['Argentina/Argentina 2026 Messi', 'ARGM_0000s_0001_T1-DORSO.png'],
  ['Boca/Boca 2026', 'BJ26_0014_T8-FRENTE.png'],
  ['Boca/Boca 2026', 'BJ26_0015_T8-DORSO.png'],
  ['Huracan', 'HUR_0018_T10-FRENTE.png'],
  ['Huracan', 'HUR_0019_T10-DORSO.png'],
];
if (!Array.isArray(requested) || requested.length !== 6) throw new Error('Se requieren seis muestras explícitas.');
const samples = requested.map(([folder, fileName]) => {
  const item = manifest.generated.find(entry => entry.folder === folder && entry.fileName === fileName);
  if (!item) throw new Error(`Falta muestra staged ${folder}/${fileName}`);
  return { folder, item };
});
const root = path.join(manifest.stageRoot, process.argv[4] ?? 'imprenta2-marker-probes');
if (path.dirname(root) !== path.resolve(manifest.stageRoot)) throw new Error('El directorio de probes debe ser hijo directo del staging/postflight.');
const sourceDir = path.join(root, 'sources');
await mkdir(sourceDir, { recursive: true });
const server = await createServer({ configFile: false, root: repo, appType: 'custom', server: { middlewareMode: true, watch: null, hmr: false } });
try {
  const [geometry, exporter, sourceCrop] = await Promise.all([
    server.ssrLoadModule('/src/geometry/alpha-polygon.ts'),
    server.ssrLoadModule('/src/export/native-png-export.ts'),
    server.ssrLoadModule('/src/export/export-source-crop.ts'),
  ]);
  const probes = [];
  for (const { folder, item } of samples) {
    const marker = item.sizeMark.placement;
    const x0 = Math.max(0, marker.x - 32);
    const y0 = Math.max(0, marker.y - 20);
    const x1 = Math.min(item.widthPx, marker.x + marker.width + 32);
    const y1 = Math.min(item.heightPx, marker.y + marker.height + 24);
    const cropWidth = x1 - x0;
    const cropHeight = y1 - y0;
    const stem = item.fileName.replace(/\.png$/i, '').replace(/[^a-z0-9_-]+/gi, '_');
    const sourcePath = path.join(sourceDir, `${stem}.png`);
    const crop = spawnSync('python', [codec, 'crop', item.stagedPath, String(x0), String(y0), String(cropWidth), String(cropHeight), sourcePath], {
      encoding: null,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
      env: { ...process.env, NESTRA_MOLD_PYTHONPATH: pythonPath },
    });
    if (crop.error || crop.status !== 0) throw crop.error ?? new Error(crop.stderr.toString());
    const rgba = new Uint8ClampedArray(crop.stdout);
    if (rgba.length !== cropWidth * cropHeight * 4) throw new Error(`Crop RGBA truncado: ${item.relativePath}`);
    const clean = sourceCrop.suppressEmbeddedSizeMark(
      rgba,
      cropWidth,
      cropHeight,
      { version: 1, size: item.size, ...marker },
      x0,
      y0,
    );
    const encoded = spawnSync('python', [codec, 'encode', String(cropWidth), String(cropHeight), sourcePath], {
      input: Buffer.from(clean), encoding: null, maxBuffer: 64 * 1024 * 1024,
      windowsHide: true, env: { ...process.env, NESTRA_MOLD_PYTHONPATH: pythonPath },
    });
    if (encoded.error || encoded.status !== 0) throw encoded.error ?? new Error(encoded.stderr.toString());

    const sourcePpiMm = 25.4 / 72;
    const pxPerMm = 300 / 25.4;
    const marginMm = 20;
    const pieceWidthMm = cropWidth * sourcePpiMm;
    const pieceHeightMm = cropHeight * sourcePpiMm;
    const pageWidthMm = 1560;
    const pageWidthPx = Math.floor(pageWidthMm * pxPerMm);
    const marginXmm = (pageWidthMm - pieceWidthMm) / 2;
    const pageHeightPx = Math.ceil((pieceHeightMm + 2 * marginMm) * pxPerMm);
    const pageHeightMm = pageHeightPx / pxPerMm;
    const raster = { width: cropWidth, height: cropHeight, data: rgba };
    const components = geometry.extractAlphaComponents(raster, 16);
    if (!components.length) throw new Error(`No hay contorno alpha >16 en ${item.relativePath}`);
    const cutComponents = components.map(polygon => polygon.map(point => ({
      x: marginXmm + point.x * sourcePpiMm,
      y: marginMm + point.y * sourcePpiMm,
    })));
    const id = `probe-${probes.length}`;
    const definition = {
      id, fileName: item.fileName, kind: 'garment', model: path.posix.basename(folder),
      size: item.size, side: item.side, sourceWidthPx: cropWidth, sourceHeightPx: cropHeight,
      physicalWidthMm: pieceWidthMm, physicalHeightMm: pieceHeightMm,
    };
    const art = {
      definition,
      placement: { x: marginXmm, y: marginMm, rotation: 0 },
      translateX: marginXmm, translateY: marginMm,
      sourceCrop: { xPx: 0, yPx: 0, widthPx: cropWidth, heightPx: cropHeight,
        xMm: 0, yMm: 0, widthMm: pieceWidthMm, heightMm: pieceHeightMm },
      cutComponents,
    };
    const suffix = String.fromCharCode(97 + probes.length);
    const name = `imprenta2_1_copia_${suffix}.png`;
    const layout = {
      laserOutline: { widthMm: 3, color: '#000000' }, name, fabric: 'probe',
      widthMm: pageWidthMm, heightMm: pageHeightMm, widthPx: pageWidthPx, heightPx: pageHeightPx,
      offsetX: 0, offsetY: 0, pieces: [art],
    };
    const markMetadata = {
      version: 1, size: item.size, x: marker.x - x0, y: marker.y - y0,
      width: marker.width, height: marker.height,
    };
    const plan = exporter.nativePngPlan(layout, new Map([[id, 0]]), new Map([[id, markMetadata]]));
    probes.push({ folder, fileName: item.fileName, size: item.size, side: item.side,
      sourcePath, sourceWidth: cropWidth, sourceHeight: cropHeight, cropOrigin: { x: x0, y: y0 },
      sourceMarker: { ...marker }, plan });
  }
  const probeManifest = path.join(root, 'probe-input.json');
  await writeFile(probeManifest, JSON.stringify({ samples: probes }, null, 2));
  process.stdout.write(JSON.stringify({ probeManifest, outputDir: path.join(root, 'exports'), samples: probes.map(({ folder, fileName, size, side, sourceMarker }) => ({ folder, fileName, size, side, sourceMarker })) }) + '\n');
} finally {
  await server.close();
}
