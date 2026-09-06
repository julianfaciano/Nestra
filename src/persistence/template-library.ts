import type { SizeTemplateDraft } from '../app/size-template-state';
import { GARMENT_SIZES } from '../domain/size';
import { PIECE_SIDES } from '../domain/piece-side';

const DB_NAME = 'nestra-library';
const STORE = 'library';
const KEY = 'current';
interface StoredTemplate {
  readonly size: SizeTemplateDraft['size'];
  readonly side: SizeTemplateDraft['side'];
  readonly widthPx?: number | undefined;
  readonly heightPx?: number | undefined;
  readonly physicalWidthMm?: number | undefined;
  readonly physicalHeightMm?: number | undefined;
  readonly alphaThreshold?: number | undefined;
  readonly simplificationTolerancePx?: number | undefined;
  readonly image?: Blob | undefined;
  readonly fileName?: string | undefined;
}
interface StoredLibrary { readonly version: 1; readonly templates: readonly StoredTemplate[]; }

export function serializeLibrary(templates: readonly SizeTemplateDraft[]): StoredLibrary {
  return { version:1, templates:templates.map(t => ({
    size:t.size, side:t.side, widthPx:t.widthPx, heightPx:t.heightPx,
    physicalWidthMm:t.physicalWidthMm, physicalHeightMm:t.physicalHeightMm,
    alphaThreshold:t.alphaThreshold, simplificationTolerancePx:t.simplificationTolerancePx,
    image:t.file, fileName:t.file?.name,
  })) };
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
export function validateStoredLibrary(value: unknown): asserts value is StoredLibrary {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.templates) || value.templates.length > 20) throw new Error('Biblioteca local inválida o versión no soportada.');
  const slots = new Set<string>();
  for (const t of value.templates) {
    if (!record(t) || !GARMENT_SIZES.some(s => s === t.size) || !PIECE_SIDES.some(s => s === t.side)) throw new Error('Talle/lado inválido en biblioteca.');
    const key = String(t.size) + '/' + String(t.side);
    if (slots.has(key)) throw new Error('Silueta duplicada en biblioteca.');
    slots.add(key);
    for (const field of ['widthPx','heightPx','physicalWidthMm','physicalHeightMm']) {
      const n = t[field];
      if (n !== undefined && (typeof n !== 'number' || !Number.isFinite(n) || n <= 0)) throw new Error('Medida inválida en biblioteca: ' + field);
    }
    if (t.alphaThreshold !== undefined && (typeof t.alphaThreshold !== 'number' || !Number.isInteger(t.alphaThreshold) || t.alphaThreshold < 0 || t.alphaThreshold > 255)) throw new Error('Threshold inválido.');
    if (t.simplificationTolerancePx !== undefined && (typeof t.simplificationTolerancePx !== 'number' || !Number.isFinite(t.simplificationTolerancePx) || t.simplificationTolerancePx < 0 || t.simplificationTolerancePx > 10)) throw new Error('Simplificación inválida.');
    if (t.image !== undefined && (!(t.image instanceof Blob) || t.image.type !== 'image/png' || t.image.size > 32 * 1024 * 1024 || typeof t.fileName !== 'string')) throw new Error('Imagen local inválida.');
  }
}
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('IndexedDB no disponible.')); return; }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('No se pudo abrir la biblioteca.'));
    request.onblocked = () => reject(new Error('Cerrá otras ventanas de Nestra para abrir la biblioteca.'));
  });
}
export async function loadLibrary(): Promise<SizeTemplateDraft[]> {
  const db = await openDatabase();
  try {
    const value: unknown = await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readonly');
      const request = transaction.objectStore(STORE).get(KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (value === undefined) return [];
    validateStoredLibrary(value);
    return value.templates.map(t => {
      const file = t.image ? new File([t.image], t.fileName ?? 'silueta.png', {type:'image/png'}) : undefined;
      return { size:t.size, side:t.side, widthPx:t.widthPx, heightPx:t.heightPx,
        physicalWidthMm:t.physicalWidthMm, physicalHeightMm:t.physicalHeightMm,
        alphaThreshold:t.alphaThreshold, simplificationTolerancePx:t.simplificationTolerancePx,
        file, previewUrl:file ? URL.createObjectURL(file) : undefined };
    });
  } finally { db.close(); }
}
export async function saveLibrary(templates: readonly SizeTemplateDraft[]): Promise<void> {
  const value = serializeLibrary(templates);
  validateStoredLibrary(value);
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).put(value, KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error('Guardado cancelado.'));
    });
  } finally { db.close(); }
}

