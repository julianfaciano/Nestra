import { invoke } from '@tauri-apps/api/core';
import { DEFAULT_FREE_PNG_FABRIC } from '../domain/fabric';
import type { FreePngDraft } from './batch-state';

// Covers 148 × 500 cm at 72 PPI (~59.5 MP), independently of garment limits.
export const MAX_FREE_PNG_SOURCE_PIXELS = 64_000_000;

export function validFreePngQuantity(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1;
}

export async function chooseFreePng(
  quantity: number,
): Promise<FreePngDraft | null> {
  if (!validFreePngQuantity(quantity))
    throw new Error('La cantidad debe ser un entero mayor que cero.');
  const selection = await invoke<{ fileName: string; bytes: number[] } | null>(
    'choose_free_png',
  );
  if (!selection) return null;
  const file = new File([new Uint8Array(selection.bytes)], selection.fileName, {
    type: 'image/png',
  });
  let image: ImageBitmap;
  try {
    image = await createImageBitmap(file);
  } catch {
    throw new Error('PNG inválido o no compatible.');
  }
  try {
    if (
      image.width <= 0 ||
      image.height <= 0
    ) {
      throw new Error('PNG inválido o no compatible.');
    }
    const pixels = image.width * image.height;
    if (pixels > MAX_FREE_PNG_SOURCE_PIXELS) {
      const megapixels = (pixels / 1_000_000).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
      throw new Error(`PNG demasiado grande: ${image.width} × ${image.height} px (${megapixels} MP). Máximo admitido: 64 MP.`);
    }
    return {
      kind: 'free-png',
      id: crypto.randomUUID(),
      file,
      fabric: DEFAULT_FREE_PNG_FABRIC,
      quantity,
      sourceWidthPx: image.width,
      sourceHeightPx: image.height,
      imageUrl: URL.createObjectURL(file),
    };
  } finally {
    image.close();
  }
}
