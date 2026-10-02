// Read-only contour preflight for the 2026-10-01 production-order fixture.
// Reads original PNGs, derives the same Imprenta 2 geometry as BatchPage, and
// writes only a compact aggregate report; it never changes source assets.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const moduleCache = new Map();

function load(file) {
  const absolute = path.resolve(file);
  if (moduleCache.has(absolute)) return moduleCache.get(absolute);
  const mod = { exports: {} };
  moduleCache.set(absolute, mod.exports);
  const source = fs.readFileSync(absolute, 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${js}\n})`, { filename: absolute })(
    name => name.startsWith('.') ? load(path.resolve(path.dirname(absolute), `${name}.ts`)) : require(name),
    mod,
    mod.exports,
  );
  moduleCache.set(absolute, mod.exports);
  return mod.exports;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function decodeRgbaPng(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!buffer.subarray(0, 8).equals(signature)) throw new Error('Invalid PNG signature.');
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  if (!width || !height || bitDepth !== 8 || colorType !== 6 || interlace !== 0)
    throw new Error(`Unsupported PNG format: ${width}x${height}, depth ${bitDepth}, color type ${colorType}, interlace ${interlace}.`);

  const rowBytes = width * 4;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length !== height * (rowBytes + 1)) throw new Error('Unexpected PNG scanline length.');
  const pixels = new Uint8ClampedArray(width * height * 4);
  let source = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[source++];
    const rowStart = y * rowBytes;
    for (let x = 0; x < rowBytes; x++) {
      const value = raw[source++];
      const left = x >= 4 ? pixels[rowStart + x - 4] : 0;
      const up = y > 0 ? pixels[rowStart + x - rowBytes] : 0;
      const upperLeft = y > 0 && x >= 4 ? pixels[rowStart + x - rowBytes - 4] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) predictor = paeth(left, up, upperLeft);
      else if (filter !== 0) throw new Error(`Unsupported PNG filter ${filter}.`);
      pixels[rowStart + x] = (value + predictor) & 255;
    }
  }
  return { width, height, data: pixels };
}

const audit = JSON.parse(fs.readFileSync('docs/asset-naming-audit.json', 'utf8'));
const { PRODUCTION_ORDER } = load('src/test/production-order-2026-10-01.ts');
const { parseOrderText, normalizeDesignName } = load('src/domain/order-import.ts');
const { extractAlphaPixelBounds, extractLargestAlphaPolygon, extractAlphaComponents } = load('src/geometry/alpha-polygon.ts');
const { getPolygonBounds, polygonPixelsToMillimeters, rotatePoint, transformPolygon } = load('src/geometry/polygon-transform.ts');
const { physicalSizeFromSourcePixels } = load('src/domain/source-image-size.ts');

const preview = parseOrderText(PRODUCTION_ORDER, audit.designs.map(d => ({ id: d.path, name: d.name })));
if (!preview.confirmable) throw new Error(preview.errors.join('\n'));

const logicalTypes = [];
const logicalKeys = new Set();
for (const line of preview.lines) {
  const design = audit.designs.find(d => normalizeDesignName(d.name) === normalizeDesignName(line.designName));
  if (!design) throw new Error(`Fixture design not found: ${line.designName}`);
  for (const [size, quantity] of Object.entries(line.quantities)) {
    if (!quantity) continue;
    for (const side of ['front', 'back']) {
      const key = JSON.stringify([design.path, size, side]);
      if (!logicalKeys.has(key)) {
        logicalKeys.add(key);
        logicalTypes.push({ key, design, size, side, quantity });
      }
    }
  }
}

const threshold = 16;
const fastTolerance = 3;
const fineTolerance = 1.5;
const geometryByKey = new Map();
const contourCache = new Map();
const hashes = new Set();
const timings = { assetReadMs: 0, pngDecodeMs: 0, alphaBoundsMs: 0, contourMs: 0, componentMs: 0, coordinateConversionMs: 0, rotationPreparationMs: 0 };
let cacheHits = 0;
let cacheMisses = 0;
let totalAlphaPixels = 0;
let totalContourVertices = 0;

for (let index = 0; index < logicalTypes.length; index++) {
  const type = logicalTypes[index];
  const file = type.design.pngs.find(candidate => !candidate.nom && candidate.canonical?.size === type.size && candidate.canonical?.side === type.side);
  if (!file?.path || !fs.existsSync(file.path)) throw new Error(`Missing real source for ${type.design.name} ${type.size} ${type.side}.`);

  const readStarted = performance.now();
  const bytes = fs.readFileSync(file.path);
  timings.assetReadMs += performance.now() - readStarted;
  const digest = createHash('sha256').update(bytes).digest('hex');
  hashes.add(digest);
  const cacheKey = JSON.stringify([digest, file.widthPx, file.heightPx, threshold, fastTolerance, fineTolerance, 'garment-cut-contours']);
  let pair = contourCache.get(cacheKey);
  if (pair) {
    cacheHits++;
  } else {
    cacheMisses++;
    const decodeStarted = performance.now();
    const image = decodeRgbaPng(bytes);
    timings.pngDecodeMs += performance.now() - decodeStarted;
    if (image.width !== file.widthPx || image.height !== file.heightPx) throw new Error(`Audit dimensions differ from real PNG: ${file.path}.`);

    const alphaStarted = performance.now();
    const sourceAlphaBounds = extractAlphaPixelBounds(image, threshold);
    timings.alphaBoundsMs += performance.now() - alphaStarted;
    if (!sourceAlphaBounds) throw new Error(`PNG has no visible alpha: ${file.path}.`);

    const contourStarted = performance.now();
    const fast = extractLargestAlphaPolygon(image, threshold, fastTolerance);
    const fine = extractLargestAlphaPolygon(image, threshold, fineTolerance);
    timings.contourMs += performance.now() - contourStarted;
    if (!fast || !fine) throw new Error(`No usable alpha contour: ${file.path}.`);

    const componentStarted = performance.now();
    const rawComponents = extractAlphaComponents(image, threshold);
    timings.componentMs += performance.now() - componentStarted;
    if (!rawComponents.length) throw new Error(`No exterior alpha components: ${file.path}.`);
    totalAlphaPixels += image.width * image.height;

    const convertStarted = performance.now();
    const physical = physicalSizeFromSourcePixels(image.width, image.height);
    const fastPolygon = polygonPixelsToMillimeters(fast.simplifiedPolygon, image.width, image.height, physical.widthMm, physical.heightMm);
    const finePolygon = polygonPixelsToMillimeters(fine.simplifiedPolygon, image.width, image.height, physical.widthMm, physical.heightMm);
    const cutComponents = rawComponents.map(polygon => polygonPixelsToMillimeters(polygon, image.width, image.height, physical.widthMm, physical.heightMm));
    const placementPixels = getPolygonBounds(fine.rawPolygon);
    const cutAnchor = [
      { x: placementPixels.minX, y: placementPixels.minY },
      { x: placementPixels.maxX, y: placementPixels.minY },
      { x: placementPixels.maxX, y: placementPixels.maxY },
      { x: placementPixels.minX, y: placementPixels.maxY },
    ].map(point => ({ x: point.x * physical.widthMm / image.width, y: point.y * physical.heightMm / image.height }));
    timings.coordinateConversionMs += performance.now() - convertStarted;
    totalContourVertices += fastPolygon.length + finePolygon.length + cutComponents.reduce((sum, polygon) => sum + polygon.length, 0);
    pair = { fastPolygon, finePolygon, cutComponents, cutAnchor };
    contourCache.set(cacheKey, pair);
  }

  const geometryKey = JSON.stringify([pair.fastPolygon, pair.finePolygon, null, pair.cutComponents, pair.cutAnchor]);
  let geometry = geometryByKey.get(geometryKey);
  if (!geometry) {
    geometry = { ...pair, index: geometryByKey.size, rotations: new Set() };
    geometryByKey.set(geometryKey, geometry);
  }
  type.geometryIndex = geometry.index;
  const allowedRotations = type.side === 'front' ? [0, 90, 180, -90] : [0, 180];
  for (const rotation of allowedRotations) geometry.rotations.add(rotation);
}

for (const geometry of geometryByKey.values()) {
  for (const rotation of geometry.rotations) {
    const start = performance.now();
    transformPolygon(geometry.fastPolygon, { x: 0, y: 0, rotation });
    transformPolygon(geometry.finePolygon, { x: 0, y: 0, rotation });
    const rotatedAnchor = getPolygonBounds(geometry.cutAnchor.map(point => rotatePoint(point, rotation)));
    geometry.cutComponents.map(polygon => polygon.map(point => {
      const rotated = rotatePoint(point, rotation);
      return { x: rotated.x - rotatedAnchor.minX, y: rotated.y - rotatedAnchor.minY };
    }));
    timings.rotationPreparationMs += performance.now() - start;
  }
}

const totalPieces = preview.totalGarments * 2;
if (totalPieces !== 1276 || logicalTypes.length !== 372)
  throw new Error(`Fixture count mismatch: ${totalPieces} pieces, ${logicalTypes.length} logical types.`);
const summary = {
  dataset: 'Real PNG contour profile (read-only)',
  fixture: 'src/test/production-order-2026-10-01.ts',
  totalPieces,
  logicalPieceTypes: logicalTypes.length,
  uniqueSourceAssets: hashes.size,
  uniqueRealGeometries: geometryByKey.size,
  uniqueGeometryRotationVariants: [...geometryByKey.values()].reduce((sum, geometry) => sum + geometry.rotations.size, 0),
  contourCache: { hits: cacheHits, misses: cacheMisses },
  sourcePixelsDecoded: totalAlphaPixels,
  derivedContourVertices: totalContourVertices,
  timingsMs: Object.fromEntries(Object.entries(timings).map(([key, value]) => [key, Number(value.toFixed(2))])),
  geometryIdentity: 'Exact serialized fast contour + fine contour + all exterior cut components + placement anchor, after conversion to physical mm.',
  safety: { sourceAssetsModified: false, orderQuantitiesModified: false, strokeWidthMm: 3, visibleGapMm: 3, nominalClearanceMm: 6, outlineExtentMm: 1.5 },
};
fs.writeFileSync('docs/imprenta-2-real-geometry-profile.json', JSON.stringify(summary, null, 2) + '\n');
const geometryOutput = process.env.NESTRA_REAL_ASSET_GEOMETRY_OUTPUT;
if (geometryOutput) {
  const nestingGeometry = {
    dataset: 'Real production PNG geometry (read-only)',
    totalPieces,
    logicalPieceTypes: logicalTypes.length,
    uniqueRealGeometries: geometryByKey.size,
    uniqueGeometryRotationVariants: [...geometryByKey.values()].reduce((sum, geometry) => sum + geometry.rotations.size, 0),
    geometries: [...geometryByKey.values()].map(({ index, fastPolygon, finePolygon, cutComponents, cutAnchor, rotations }) => ({
      index,
      fastPolygon,
      finePolygon,
      cutComponents,
      cutAnchor,
      allowedRotations: [...rotations],
    })),
    logicalTypes: logicalTypes.map(({ design, size, side, quantity, geometryIndex }) => ({
      id: `${design.name}-${size}-${side}`,
      side,
      quantity,
      geometryIndex,
      allowedRotations: side === 'front' ? [0, 90, 180, -90] : [0, 180],
    })),
  };
  fs.writeFileSync(geometryOutput, JSON.stringify(nestingGeometry) + '\n');
  summary.geometryPayload = { written: true, dataset: nestingGeometry.dataset, bytes: fs.statSync(geometryOutput).size };
  fs.writeFileSync('docs/imprenta-2-real-geometry-profile.json', JSON.stringify(summary, null, 2) + '\n');
}
console.log('REAL_ASSET_PROFILE ' + JSON.stringify(summary));
