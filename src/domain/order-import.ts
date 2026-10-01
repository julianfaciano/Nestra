import { GARMENT_SIZES, type GarmentSize } from './size';
import { batchPieceLimitError } from './batch-piece-limit';

export interface OrderDesign {
  readonly id: string;
  readonly name: string;
}

export interface ParsedOrderLine {
  readonly entryNumber: number;
  readonly raw: string;
  readonly designName: string;
  readonly collectionId?: string;
  readonly quantities: Readonly<Record<GarmentSize, number>>;
  readonly errors: readonly string[];
  readonly suggestions: readonly string[];
}

export interface OrderPreview {
  readonly lines: readonly ParsedOrderLine[];
  readonly totalGarments: number;
  readonly totalPieces: number;
  readonly errors: readonly string[];
  readonly confirmable: boolean;
}

export function normalizeDesignName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('es');
}

export function parseOrderText(
  text: string,
  designs: readonly OrderDesign[],
  existingNonGarmentPieces = 0,
): OrderPreview {
  const entries = text.split(';');
  if (entries.length && !entries[entries.length - 1]?.trim()) entries.pop();

  const byName = new Map<string, OrderDesign[]>();
  for (const design of designs) {
    const key = normalizeDesignName(design.name);
    byName.set(key, [...(byName.get(key) ?? []), design]);
  }

  const seenNames = new Map<string, number>();
  const parsed = entries.map((raw, index) => {
    const entryNumber = index + 1;
    const errors: string[] = [];
    const quantities = Object.fromEntries(GARMENT_SIZES.map(size => [size, 0])) as Record<GarmentSize, number>;
    const firstSize = /\b(T(?:10|[1-9]))\s*=/i.exec(raw);
    const designName = firstSize ? raw.slice(0, firstSize.index).trim() : raw.trim();
    const quantityText = firstSize ? raw.slice(firstSize.index) : '';

    if (!raw.trim()) errors.push('Entrada vacía entre “;”.');
    if (!designName) errors.push('Falta el nombre del diseño antes de los talles.');
    if (!firstSize) errors.push('Falta al menos un talle, por ejemplo t1=3.');

    const normalizedName = normalizeDesignName(designName);
    const matches = normalizedName ? byName.get(normalizedName) ?? [] : [];
    let collectionId: string | undefined;
    if (designName && matches.length === 0) {
      errors.push(`Diseño no encontrado: ${designName}.`);
    } else if (matches.length > 1) {
      errors.push(`Nombre ambiguo: ${designName}.`);
    } else if (matches[0]) {
      collectionId = matches[0].id;
    }

    if (designName) {
      const previousEntry = seenNames.get(normalizedName);
      if (previousEntry !== undefined) errors.push(`Diseño duplicado: ${designName} (entradas ${previousEntry} y ${entryNumber}).`);
      else seenNames.set(normalizedName, entryNumber);
    }

    const seenSizes = new Set<GarmentSize>();
    if (firstSize) {
      for (const rawToken of quantityText.split(',')) {
        const token = rawToken.trim();
        const match = /^(T(?:10|[1-9]))\s*=\s*(.*?)$/i.exec(token);
        if (!match) {
          errors.push(`Talle inválido: ${token || '(vacío)'}. Usá t1=3 hasta t10=3, separados por comas.`);
          continue;
        }
        const size = match[1]?.toUpperCase() as GarmentSize | undefined;
        const value = match[2] ?? '';
        if (!size || !GARMENT_SIZES.includes(size)) {
          errors.push(`Talle inválido: ${token}.`);
          continue;
        }
        if (seenSizes.has(size)) {
          errors.push(`Talle duplicado: ${size}.`);
          continue;
        }
        seenSizes.add(size);
        if (!/^\d+$/.test(value)) {
          errors.push(`Cantidad inválida para ${size}: debe ser un entero mayor o igual a 0.`);
          continue;
        }
        const quantity = Number(value);
        if (!Number.isSafeInteger(quantity)) {
          errors.push(`Cantidad inválida para ${size}: excede el máximo seguro.`);
          continue;
        }
        quantities[size] = quantity;
      }
    }

    const suggestions = matches.length === 0 && normalizedName
      ? designs.map(design => design.name)
        .filter(name => {
          const candidate = normalizeDesignName(name);
          return candidate.includes(normalizedName) || normalizedName.includes(candidate);
        })
        .slice(0, 3)
      : [];
    return {
      entryNumber,
      raw,
      designName,
      ...(collectionId ? { collectionId } : {}),
      quantities,
      errors,
      suggestions,
    } satisfies ParsedOrderLine;
  });

  if (parsed.length === 0) {
    return { lines: [], totalGarments: 0, totalPieces: 0, errors: ['Pegá al menos una entrada de pedido.'], confirmable: false };
  }

  const totalGarments = parsed.reduce((total, entry) => total + Object.values(entry.quantities).reduce((sum, quantity) => sum + quantity, 0), 0);
  const totalPieces = totalGarments * 2 + Math.max(0, existingNonGarmentPieces);
  const errors = parsed.flatMap(entry => entry.errors.map(error => `Entrada ${entry.entryNumber}: ${error}`));
  const limitError = batchPieceLimitError(totalPieces);
  if (limitError) errors.push(limitError);

  return { lines: parsed, totalGarments, totalPieces, errors, confirmable: errors.length === 0 };
}

export function quantitiesFromOrder(
  preview: OrderPreview,
  designs: readonly OrderDesign[],
): Record<string, Record<GarmentSize, number>> {
  const quantities = Object.fromEntries(designs.map(design => [
    design.id,
    Object.fromEntries(GARMENT_SIZES.map(size => [size, 0])),
  ])) as Record<string, Record<GarmentSize, number>>;
  for (const entry of preview.lines) {
    if (!entry.collectionId || !quantities[entry.collectionId]) continue;
    quantities[entry.collectionId] = { ...quantities[entry.collectionId], ...entry.quantities };
  }
  return quantities;
}
