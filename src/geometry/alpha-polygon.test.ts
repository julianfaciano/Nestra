import { describe, expect, it } from 'vitest';
import type { ImageDataLike } from './alpha-contour';
import {
  extractAlphaPixelBounds,
  extractLargestAlphaPolygon,
} from './alpha-polygon';
import { getPolygonBounds } from './polygon-transform';

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
  it('usa alpha > threshold y representa un píxel con ancho exacto de 1 px', () => {
    const imageData = createImageDataLike([
      [0, 1, 15, 16, 17, 255],
    ]);

    expect(extractAlphaPixelBounds(imageData, 16)).toEqual({
      x: 4,
      y: 0,
      width: 2,
      height: 1,
    });
    expect(extractAlphaPixelBounds(createImageDataLike([[0, 255, 0]]), 16)).toEqual({
      x: 1,
      y: 0,
      width: 1,
      height: 1,
    });
    expect(extractAlphaPixelBounds(createImageDataLike([[0, 1, 15, 16]]), 16)).toBeNull();
  });

  it('puede simplificar un saliente de 1 px sin que ese píxel deje de ser imprimible', () => {
    const imageData = createImageDataLike([
      [0, 0, 0, 0, 0, 0],
      [0, 255, 255, 255, 255, 0],
      [0, 255, 255, 255, 255, 0],
      [255, 255, 255, 255, 255, 0],
      [255, 255, 255, 255, 255, 0],
      [0, 255, 255, 255, 255, 0],
      [0, 255, 255, 255, 255, 0],
      [0, 0, 0, 0, 0, 0],
    ]);
    const contour = extractLargestAlphaPolygon(imageData, 16, 1.5)!;

    expect(extractAlphaPixelBounds(imageData, 16)).toEqual({
      x: 0,
      y: 1,
      width: 5,
      height: 6,
    });
    expect(getPolygonBounds(contour.rawPolygon)).toMatchObject({
      minX: 0,
      maxX: 5,
    });
    expect(getPolygonBounds(contour.simplifiedPolygon)).toMatchObject({
      minX: 1,
      maxX: 5,
    });
  });

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
