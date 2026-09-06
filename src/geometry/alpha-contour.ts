export interface ImageDataLike {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export interface AlphaContourMask {
  readonly width: number;
  readonly height: number;
  readonly opaquePixelCount: number;
  readonly edgePixelCount: number;
  readonly edgeMask: Uint8Array;
}

export const DEFAULT_ALPHA_THRESHOLD = 16;

export function clampAlphaThreshold(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_ALPHA_THRESHOLD;
  }

  return Math.min(255, Math.max(0, Math.round(value)));
}

export function extractAlphaContourMask(
  imageData: ImageDataLike,
  alphaThreshold: number,
): AlphaContourMask {
  const threshold = clampAlphaThreshold(alphaThreshold);
  const { width, height, data } = imageData;
  const edgeMask = new Uint8Array(width * height);

  let opaquePixelCount = 0;
  let edgePixelCount = 0;

  function isOpaqueAt(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return false;
    }

    const pixelOffset = (y * width + x) * 4;
    const alpha = data[pixelOffset + 3] ?? 0;

    return alpha > threshold;
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!isOpaqueAt(x, y)) {
        continue;
      }

      opaquePixelCount += 1;

      const isEdge =
        !isOpaqueAt(x - 1, y) ||
        !isOpaqueAt(x + 1, y) ||
        !isOpaqueAt(x, y - 1) ||
        !isOpaqueAt(x, y + 1);

      if (!isEdge) {
        continue;
      }

      const index = y * width + x;
      edgeMask[index] = 1;
      edgePixelCount += 1;
    }
  }

  return {
    width,
    height,
    opaquePixelCount,
    edgePixelCount,
    edgeMask,
  };
}
