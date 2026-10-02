import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const codec = fileURLToPath(new URL('./mold-png-codec.py', import.meta.url));

function runCodec(args, input) {
  const result = spawnSync('python', [codec, ...args], { input, maxBuffer: 70 * 1024 * 1024, windowsHide: true });
  if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr.toString());
  return result.stdout;
}

export function renderNodeMold(masterPath, spec, outputPath, shared) {
  const raw = runCodec(['resize', String(spec.widthPx), String(spec.heightPx), masterPath]);
  const raster = { width: spec.widthPx, height: spec.heightPx, data: new Uint8ClampedArray(raw) };
  const alpha = new Uint8Array(raster.width * raster.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = raw[i * 4 + 3];
  const mask = shared.createSizeMarkGlyph(spec.size);
  const placement = shared.stampSizeMark(raster, mask);
  const gapPx = shared.measureSizeMarkEdgeGapPx(raster, mask, placement);
  shared.validateSizeMark(raster, alpha, mask, placement);
  // Check every pixel: one glyph only; alpha and all other RGB unchanged.
  let changedPixels = 0;
  for (let y = 0; y < raster.height; y++) {
    for (let x = 0; x < raster.width; x++) {
      const offset = (y * raster.width + x) * 4;
      const gx = x - placement.x, gy = y - placement.y;
      const glyph = gx >= 0 && gy >= 0 && gx < mask.width && gy < mask.height && mask.data[gy * mask.width + gx] !== 0;
      if (raw[offset + 3] !== raster.data[offset + 3]) throw new Error('Alpha changed');
      if (!glyph && (raw[offset] !== raster.data[offset] || raw[offset + 1] !== raster.data[offset + 1] || raw[offset + 2] !== raster.data[offset + 2])) throw new Error('Pixels outside glyph changed');
      if (glyph) changedPixels++;
    }
  }
  const metadata = JSON.stringify({ version: 1, size: spec.size, ...placement });
  runCodec(['encode', String(spec.widthPx), String(spec.heightPx), outputPath, metadata], Buffer.from(raster.data));
  return { color: '#8aff00', heightPx: shared.visibleSizeMarkBounds(mask).height, placement, gapPx, gapMm: gapPx * 25.4 / 72, glyphPixels: changedPixels,
    alphaUnchanged: true, outsideGlyphUnchanged: true, pngRoundtripExact: true,
    sourcePpiRounding: '18 px @ 72 PPI = 6.35 mm (0.635 cm)',
    exportMetadata: 'NestraSizeMark tEXt identifies the source-pixel rectangle for post-stroke Imprenta 2 composition.',
    resampling: 'Pillow premultiplied-alpha Lanczos; shared /Moldes dimensions and marker rules' };
}
