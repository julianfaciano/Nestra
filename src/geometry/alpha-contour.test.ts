import { describe, expect, it } from 'vitest';
import {
  clampAlphaThreshold,
  extractAlphaContourMask,
  type ImageDataLike,
} from './alpha-contour';

function createImageDataLike(alphaMatrix: number[][]): ImageDataLike {
  const height = alphaMatrix.length;
  const firstRow = alphaMatrix[0];

  if (!firstRow) {
    throw new Error('La matriz alpha no puede estar vacía.');
  }

  const width = firstRow.length;
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const row = alphaMatrix[y];

      if (!row) {
        throw new Error(`Falta la fila ${y} en la matriz alpha.`);
      }

      const alpha = row[x] ?? 0;

      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = alpha;
    }
  }

  return {
    width,
    height,
    data,
  };
}

describe('alpha contour', () => {
  it('detecta el borde de un bloque sólido', () => {
    const imageData = createImageDataLike([
      [0, 0, 0, 0, 0],
      [0, 255, 255, 255, 0],
      [0, 255, 255, 255, 0],
      [0, 255, 255, 255, 0],
      [0, 0, 0, 0, 0],
    ]);

    const result = extractAlphaContourMask(imageData, 16);

    expect(result.opaquePixelCount).toBe(9);
    expect(result.edgePixelCount).toBe(8);

    const centerIndex = 2 * result.width + 2;
    const topLeftIndex = 1 * result.width + 1;

    expect(result.edgeMask[centerIndex]).toBe(0);
    expect(result.edgeMask[topLeftIndex]).toBe(1);
  });

  it('respeta el threshold de alpha', () => {
    const imageData = createImageDataLike([
      [0, 0, 0],
      [0, 10, 0],
      [0, 0, 0],
    ]);

    const highThreshold = extractAlphaContourMask(imageData, 16);
    const lowThreshold = extractAlphaContourMask(imageData, 5);

    expect(highThreshold.opaquePixelCount).toBe(0);
    expect(highThreshold.edgePixelCount).toBe(0);

    expect(lowThreshold.opaquePixelCount).toBe(1);
    expect(lowThreshold.edgePixelCount).toBe(1);
  });

  it('clampa thresholds inválidos', () => {
    expect(clampAlphaThreshold(-10)).toBe(0);
    expect(clampAlphaThreshold(300)).toBe(255);
  });
});
