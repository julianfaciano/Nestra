import { describe, expect, it } from 'vitest';
import type { ImageDataLike } from './alpha-contour';
import { extractLargestAlphaPolygon } from './alpha-polygon';

function createImageDataLike(
  alphaMatrix: readonly (readonly number[])[],
): ImageDataLike {
  const height = alphaMatrix.length;
  const firstRow = alphaMatrix[0];

  if (!firstRow) {
    throw new Error('La matriz alpha no puede estar vacía.');
  }

  const width = firstRow.length;
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    const row = alphaMatrix[y];

    if (!row) {
      throw new Error(`Falta la fila ${y}.`);
    }

    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;

      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = row[x] ?? 0;
    }
  }

  return {
    width,
    height,
    data,
  };
}

describe('alpha polygon', () => {
  it('extrae el contorno exterior de un bloque', () => {
    const imageData = createImageDataLike([
      [0, 0, 0, 0],
      [0, 255, 255, 0],
      [0, 255, 255, 0],
      [0, 0, 0, 0],
    ]);

    const result = extractLargestAlphaPolygon(imageData, 16, 0);

    expect(result).not.toBeNull();
    expect(result?.rawPointCount).toBeGreaterThanOrEqual(8);
  });

  it('simplifica el número de puntos', () => {
    const imageData = createImageDataLike([
      [0, 0, 0, 0, 0, 0],
      [0, 255, 255, 255, 255, 0],
      [0, 255, 255, 255, 255, 0],
      [0, 255, 255, 255, 255, 0],
      [0, 0, 0, 0, 0, 0],
    ]);

    const result = extractLargestAlphaPolygon(imageData, 16, 1);

    expect(result).not.toBeNull();

    if (!result) {
      return;
    }

    expect(result.simplifiedPointCount).toBeLessThanOrEqual(
      result.rawPointCount,
    );
  });

  it('devuelve null si no hay píxeles ocupados', () => {
    const imageData = createImageDataLike([
      [0, 0],
      [0, 0],
    ]);

    expect(extractLargestAlphaPolygon(imageData, 16, 1)).toBeNull();
  });
});
