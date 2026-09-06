export interface PngPhysicalSize {
  readonly widthMm: number;
  readonly heightMm: number;
  readonly pixelsPerMeterX: number;
  readonly pixelsPerMeterY: number;
}

function readUint32(
  view: DataView,
  offset: number,
): number {
  return view.getUint32(offset, false);
}

function readChunkType(
  bytes: Uint8Array,
  offset: number,
): string {
  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  );
}

export function readPngPhysicalSize(
  buffer: ArrayBuffer,
): PngPhysicalSize | null {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  if (bytes.length < 8) {
    return null;
  }

  const signature = [
    137, 80, 78, 71, 13, 10, 26, 10,
  ];

  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[index] !== signature[index]) {
      return null;
    }
  }

  let offset = 8;
  let widthPx: number | null = null;
  let heightPx: number | null = null;

  while (offset + 12 <= bytes.length) {
    const length = readUint32(view, offset);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    const nextOffset = dataOffset + length + 4;

    if (nextOffset > bytes.length) {
      return null;
    }

    const type = readChunkType(bytes, typeOffset);

    if (type === 'IHDR' && length >= 8) {
      widthPx = readUint32(view, dataOffset);
      heightPx = readUint32(view, dataOffset + 4);
    }

    if (
      type === 'pHYs' &&
      length === 9 &&
      widthPx !== null &&
      heightPx !== null
    ) {
      const pixelsPerMeterX = readUint32(
        view,
        dataOffset,
      );

      const pixelsPerMeterY = readUint32(
        view,
        dataOffset + 4,
      );

      const unitSpecifier = bytes[dataOffset + 8];

      if (
        unitSpecifier !== 1 ||
        pixelsPerMeterX <= 0 ||
        pixelsPerMeterY <= 0
      ) {
        return null;
      }

      return {
        widthMm:
          (widthPx / pixelsPerMeterX) * 1000,
        heightMm:
          (heightPx / pixelsPerMeterY) * 1000,
        pixelsPerMeterX,
        pixelsPerMeterY,
      };
    }

    offset = nextOffset;
  }

  return null;
}

export async function readPngPhysicalSizeFromFile(
  file: File,
): Promise<PngPhysicalSize | null> {
  return readPngPhysicalSize(await file.arrayBuffer());
}