export interface SizeMarkPngMetadata {
  readonly version: 1;
  readonly size: `T${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10}`;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;
const PNG_TEXT_KEYWORD = 'NestraSizeMark';

/** Reads the private tEXt chunk written by the canonical mold generator. */
export function readSizeMarkPngMetadata(input: Uint8Array): SizeMarkPngMetadata | undefined {
  if (input.length < 8 || !PNG_SIGNATURE.every((byte, index) => input[index] === byte)) return undefined;
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  let offset = 8;
  let result: SizeMarkPngMetadata | undefined;
  while (offset + 12 <= input.length) {
    const length = view.getUint32(offset, false);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > input.length) throw new Error('Chunk PNG truncado al leer el marcador de talle.');
    const type = String.fromCharCode(...input.subarray(offset + 4, offset + 8));
    if (type === 'tEXt') {
      const zero = input.indexOf(0, dataStart);
      if (zero >= dataStart && zero < dataEnd &&
          new TextDecoder('latin1').decode(input.subarray(dataStart, zero)) === PNG_TEXT_KEYWORD) {
        if (result) throw new Error('El PNG contiene metadata de marcador duplicada.');
        const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(input.subarray(zero + 1, dataEnd)));
        if (!isSizeMarkMetadata(parsed)) throw new Error('La metadata del marcador de talle es inválida.');
        result = parsed;
      }
    }
    offset = dataEnd + 4;
    if (type === 'IEND') break;
  }
  return result;
}

export async function appendSizeMarkPngMetadata(blob: Blob, metadata: SizeMarkPngMetadata): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length < 20 || !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    throw new Error('No se pudo agregar metadata: la salida no es un PNG válido.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let insertAt = -1;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset, false);
    const dataEnd = offset + 8 + length;
    if (dataEnd + 4 > bytes.length) throw new Error('PNG truncado al escribir metadata del marcador.');
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type === 'tEXt') {
      const zero = bytes.indexOf(0, offset + 8);
      if (zero >= offset + 8 && zero < dataEnd &&
          new TextDecoder('latin1').decode(bytes.subarray(offset + 8, zero)) === PNG_TEXT_KEYWORD) {
        throw new Error('La salida ya contiene metadata del marcador de talle.');
      }
    }
    if (type === 'IEND') { insertAt = offset; break; }
    offset = dataEnd + 4;
  }
  if (insertAt < 0) throw new Error('PNG sin bloque IEND al escribir metadata.');
  const text = new TextEncoder().encode(JSON.stringify(metadata));
  const keyword = new TextEncoder().encode(PNG_TEXT_KEYWORD);
  const payload = new Uint8Array(keyword.length + 1 + text.length);
  payload.set(keyword, 0);
  payload.set(text, keyword.length + 1);
  const chunk = new Uint8Array(payload.length + 12);
  const chunkView = new DataView(chunk.buffer);
  chunkView.setUint32(0, payload.length, false);
  chunk.set([116, 69, 88, 116], 4); // tEXt
  chunk.set(payload, 8);
  chunkView.setUint32(8 + payload.length, crc32(chunk.subarray(4, 8 + payload.length)), false);
  const output = new Uint8Array(bytes.length + chunk.length);
  output.set(bytes.subarray(0, insertAt));
  output.set(chunk, insertAt);
  output.set(bytes.subarray(insertAt), insertAt + chunk.length);
  const result = new Blob([output], { type: 'image/png' });
  const decoded = readSizeMarkPngMetadata(output);
  if (!decoded || JSON.stringify(decoded) !== JSON.stringify(metadata)) {
    throw new Error('La metadata del marcador no pasó la verificación PNG.');
  }
  return result;
}

function isSizeMarkMetadata(value: unknown): value is SizeMarkPngMetadata {
  if (!value || typeof value !== 'object') return false;
  const mark = value as Record<string, unknown>;
  return mark.version === 1 && typeof mark.size === 'string' && /^T(?:[1-9]|10)$/.test(mark.size) &&
    Number.isSafeInteger(mark.x) && typeof mark.x === 'number' && mark.x >= 0 &&
    Number.isSafeInteger(mark.y) && typeof mark.y === 'number' && mark.y >= 0 &&
    Number.isSafeInteger(mark.width) && typeof mark.width === 'number' && mark.width > 0 && mark.height === 18;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
