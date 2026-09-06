import { pieceDefinitionLabel, type BatchPieceDefinition } from '../domain/production-batch';
import type { CanvasProfile } from '../domain/canvas-profile';
import { expandPieceDefinitions } from '../domain/piece-instance';
import { getAllowedRotationsForPiece } from '../domain/piece-rotation';
import type { Polygon } from '../geometry/polygon';
import type { MultiNestingLayout } from '../geometry/multi-piece-nesting-engine';
import { getPolygonBounds, rotatePoint, transformPolygon, type PolygonPlacement } from '../geometry/polygon-transform';
import { polygonsOverlap } from '../geometry/polygon-collision';
import { polygonFitsInsideCanvas } from '../geometry/canvas-geometry';
import { artworkBounds } from '../geometry/artwork-bounds';
import { extraPieceId, type ExtraPieceIdentity } from '../geometry/filler-types';

export const EXPORT_PPI = 300;
export const PX_PER_MM = EXPORT_PPI / 25.4;
export interface FabricBatchResult {
  readonly fabric: string;
  readonly layouts: readonly MultiNestingLayout[];
  readonly unplacedPieceIds: readonly string[];
  readonly elapsedMs: number;
}
export interface PreparedBatch {
  readonly definitions: readonly BatchPieceDefinition[];
  readonly polygons: ReadonlyMap<string, Polygon>;
  readonly results: readonly FabricBatchResult[];
  readonly profile: CanvasProfile;
}
export interface ArtworkPlacement {
  readonly extra?: ExtraPieceIdentity;
  readonly definition: BatchPieceDefinition;
  readonly placement: PolygonPlacement;
  readonly translateX: number;
  readonly translateY: number;
}
export interface ExportLayout {
  readonly name: string;
  readonly fabric: string;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly pieces: readonly ArtworkPlacement[];
}
export interface PreflightReport {
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly layouts: readonly ExportLayout[];
}

export function fabricSlug(fabric: string): string {
  return fabric.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'tela';
}
export function letterSuffix(index: number): string {
  let value = index + 1;
  let result = '';
  while (value > 0) { value--; result = String.fromCharCode(97 + value % 26) + result; value = Math.floor(value / 26); }
  return index === 0 ? '' : '_' + result;
}
export function physicalArtworkHeight(
  widthMm: number,
  heightMm: number,
  widthPx: number,
  heightPx: number,
): number {
  if (
    ![widthMm, heightMm, widthPx, heightPx].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  ) {
    throw new Error('Dimensiones físicas/raster inválidas.');
  }

  return heightMm;
}

function stableNumber(value: number): string {
  return value.toFixed(4);
}

function exportLayoutSignature(
  layout: ExportLayout,
): string {
  const pieceSignatures = layout.pieces
    .map((art) => {
      /*
       * Usamos posiciones relativas al recorte exportado.
       * Así dos layouts iguales siguen siendo iguales aunque
       * el motor los haya ubicado en otro origen del canvas.
       *
       * definition.id hace la comparación conservadora:
       * piezas con artes distintos nunca se deduplican solo
       * por compartir geometría.
       */
      const relativeX =
        art.translateX - layout.offsetX;

      const relativeY =
        art.translateY - layout.offsetY;

      return [
        art.definition.id,
        art.definition.fileName,
        ...(art.definition.kind === 'garment'
          ? [art.definition.model, art.definition.size, art.definition.side]
          : [art.definition.kind]),
        art.placement.rotation,
        stableNumber(relativeX),
        stableNumber(relativeY),
        stableNumber(
          art.definition.physicalWidthMm,
        ),
        stableNumber(
          art.definition.physicalHeightMm,
        ),
      ].join('|');
    })
    .sort();

  return JSON.stringify({
    fabric: layout.fabric,
    widthMm: stableNumber(layout.widthMm),
    heightMm: stableNumber(layout.heightMm),
    widthPx: layout.widthPx,
    heightPx: layout.heightPx,
    pieces: pieceSignatures,
  });
}

export function deduplicateExportLayouts(
  layouts: readonly ExportLayout[],
): ExportLayout[] {
  const grouped = new Map<
    string,
    {
      readonly layout: ExportLayout;
      copies: number;
    }
  >();

  for (const layout of layouts) {
    const signature =
      exportLayoutSignature(layout);

    const existing = grouped.get(signature);

    if (existing) {
      existing.copies += 1;
      continue;
    }

    grouped.set(signature, {
      layout,
      copies: 1,
    });
  }

  const nameIndexes = new Map<string, number>();
  const result: ExportLayout[] = [];

  for (const group of grouped.values()) {
    const base = fabricSlug(group.layout.fabric);

    const nameIndex =
      nameIndexes.get(base) ?? 0;

    nameIndexes.set(base, nameIndex + 1);

    const copyLabel =
      group.copies === 1
        ? '1_copia'
        : `${group.copies}_copias`;

    result.push({
      ...group.layout,
      name:
        `${base}_${copyLabel}` +
        `${letterSuffix(nameIndex)}.png`,
    });
  }

  return result;
}

export function preflightBatch(batch: PreparedBatch): PreflightReport {
  const errors: string[] = [];
  const warnings = [
  'Preflight sobre contornos simplificados: revisá los bordes e islas de alpha antes de producir.',
];
  const layouts: ExportLayout[] = [];
  const { profile } = batch;
  if (!Number.isFinite(profile.maxWidth) || profile.maxWidth <= 0 || profile.maxWidth > 1480 ||
      !Number.isFinite(profile.maxHeight) || profile.maxHeight <= 0 ||
      profile.maxHeight > (profile.kind === 'calandra' ? 5000 : 1000)) errors.push('Perfil físico inválido.');
  if (batch.definitions.length === 0) errors.push('El batch está vacío.');
  const ids = new Set<string>();
  const pairing = new Map<string, { front: number; back: number }>();
  for (const d of batch.definitions) {
    if (ids.has(d.id)) errors.push('Definición duplicada: ' + d.id);
    ids.add(d.id);
    const label = pieceDefinitionLabel(d);
    if (!Number.isSafeInteger(d.quantity) || d.quantity <= 0) errors.push('Cantidad inválida: ' + label);
    if (!d.imageUrl || !d.fileName) errors.push('Falta imagen: ' + label);
    try { physicalArtworkHeight(d.physicalWidthMm, d.physicalHeightMm, d.sourceWidthPx, d.sourceHeightPx); }
    catch (e) { errors.push(label + ': ' + String(e)); }
    if (d.kind === 'free-png') continue;
    const key = JSON.stringify([d.fabric, d.model, d.size]);
    const pair = pairing.get(key) ?? { front: 0, back: 0 };
    pair[d.side] += d.quantity;
    pairing.set(key, pair);
  }
  for (const [key, count] of pairing) if (count.front !== count.back) errors.push('Frente/dorso incompletos ' + key + ': ' + count.front + '/' + count.back + '.');
  if (errors.length) return { errors, warnings, layouts };
  const expected = new Map(expandPieceDefinitions(batch.definitions).map(p => [p.id, p]));
  const definitionsById = new Map(batch.definitions.map(d => [d.id, d]));
  const extraCopies = new Map<string, Set<number>>();
  const seen = new Set<string>();
  const names = new Map<string, number>();
  for (const result of batch.results) {
    if (result.unplacedPieceIds.length) errors.push(result.fabric + ': ' + result.unplacedPieceIds.length + ' piezas sin colocar.');
    for (const layout of result.layouts) {
      const hasExtras = layout.pieces.some(piece => piece.extra);
      const required = hasExtras ? layout.pieces.filter(piece => !piece.extra) : [];
      const requiredHeight = required.reduce((height, piece) => {
        const instance = expected.get(piece.pieceId);
        const polygon = instance && batch.polygons.get(instance.definitionId);
        return polygon?.length ? Math.max(height, getPolygonBounds(transformPolygon(polygon, piece.placement)).maxY) : height;
      }, 0);
      const requiredArts = required.flatMap(piece => {
        const d = expected.get(piece.pieceId)?.definition;
        const polygon = d && batch.polygons.get(d.id);
        return d && polygon?.length ? [artworkBounds(polygon, piece.placement, { width: d.physicalWidthMm, height: d.physicalHeightMm })] : [];
      });
      const requiredMinY = Math.min(...requiredArts.map(bounds => bounds.minY));
      const requiredMaxY = Math.max(...requiredArts.map(bounds => bounds.maxY));
      if (hasExtras &&
          (!required.length || layout.requiredUsedHeight !== requiredHeight || layout.usedHeight !== requiredHeight)) {
        errors.push('El relleno alteró el material requerido o creó un canvas.');
      }
      const arts: ArtworkPlacement[] = [];
      const actualPolygons: Polygon[] = [];
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const piece of layout.pieces) {
        let d: BatchPieceDefinition | undefined;
        if (piece.extra) {
          d = definitionsById.get(piece.extra.definitionId);
          if (!d || d.kind !== 'free-png' || !d.fill || !Number.isSafeInteger(d.fill.priority) || d.fill.priority < 1 ||
              !Number.isSafeInteger(piece.extra.copyIndex) || piece.extra.copyIndex < 0 ||
              piece.pieceId !== extraPieceId(d.id, piece.extra.copyIndex)) {
            errors.push('Relleno no autorizado: ' + piece.pieceId); continue;
          }
          const copies = extraCopies.get(d.id) ?? new Set<number>();
          copies.add(piece.extra.copyIndex);
          extraCopies.set(d.id, copies);
        } else {
          d = expected.get(piece.pieceId)?.definition;
        }
        if (!d) { errors.push('Pieza no solicitada: ' + piece.pieceId); continue; }
        if (seen.has(piece.pieceId)) errors.push('Pieza duplicada: ' + piece.pieceId);
        seen.add(piece.pieceId);
        const polygon = batch.polygons.get(d.id);
        if (!polygon || polygon.length < 3 || !polygon.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) { errors.push('Geometría inválida: ' + pieceDefinitionLabel(d)); continue; }
        if (d.fabric !== result.fabric) errors.push('Mezcla de telas en canvas.');
        if (!getAllowedRotationsForPiece(d).includes(piece.placement.rotation) ||
            !Number.isFinite(piece.placement.x) || !Number.isFinite(piece.placement.y)) { errors.push('Posición/rotación inválida: ' + piece.pieceId); continue; }
        const transformed = transformPolygon(polygon, piece.placement);
        if (piece.extra && !polygonFitsInsideCanvas(transformed, { width: profile.maxWidth, height: requiredHeight })) {
          errors.push('Relleno fuera de la altura requerida: ' + piece.pieceId);
        }
        actualPolygons.push(transformed);
        if (!polygonFitsInsideCanvas(transformed, { width: profile.maxWidth, height: profile.maxHeight })) errors.push('Pieza fuera del canvas: ' + piece.pieceId);
        const rotated = getPolygonBounds(polygon.map(p => rotatePoint(p, piece.placement.rotation)));
        const tx = piece.placement.x - rotated.minX, ty = piece.placement.y - rotated.minY;
        const full = [{x:0,y:0},{x:d.physicalWidthMm,y:0},{x:d.physicalWidthMm,y:d.physicalHeightMm},{x:0,y:d.physicalHeightMm}]
          .map(p => { const r = rotatePoint(p, piece.placement.rotation); return {x:r.x+tx,y:r.y+ty}; });
        const bounds = getPolygonBounds(full);
        if (piece.extra && (bounds.minY < requiredMinY || bounds.maxY > requiredMaxY)) {
          errors.push('El PNG de relleno aumenta la altura del PDF: ' + piece.pieceId);
        }
        minX = Math.min(minX, bounds.minX); minY = Math.min(minY, bounds.minY);
        maxX = Math.max(maxX, bounds.maxX); maxY = Math.max(maxY, bounds.maxY);
        arts.push({ definition:d, placement:piece.placement, translateX:tx, translateY:ty, ...(piece.extra ? { extra: piece.extra } : {}) });
      }
      for (let a = 0; a < actualPolygons.length; a++) for (let b = a+1; b < actualPolygons.length; b++) {
        if (polygonsOverlap(actualPolygons[a]!, actualPolygons[b]!)) errors.push(result.fabric + ': colisión en canvas ' + (layout.index + 1));
      }
      // Include complete source rectangles: transparent margins cannot silently clip artwork.
      const widthMm = maxX - minX, heightMm = maxY - minY;
      if (!(widthMm > 0 && heightMm > 0) || widthMm > profile.maxWidth + 1e-7 || heightMm > profile.maxHeight + 1e-7) {
        errors.push(result.fabric + ': el arte completo, incluidos márgenes PNG, excede el perfil. Recortá márgenes o revisá la calibración.');
        continue;
      }
      const base = fabricSlug(result.fabric);
      const index = names.get(base) ?? 0; names.set(base, index+1);
      const widthPx = Math.max(1, Math.round(widthMm * PX_PER_MM));
      const heightPx = Math.max(1, Math.round(heightMm * PX_PER_MM));
      if (widthPx > Math.floor(profile.maxWidth * PX_PER_MM) || heightPx > Math.floor(profile.maxHeight * PX_PER_MM)) {
        errors.push('El redondeo raster excede el perfil; dejá al menos 0,1 mm de margen.'); continue;
      }
      layouts.push({name: base + '_1_copia' + letterSuffix(index) + '.png', fabric:result.fabric, widthMm,heightMm,widthPx,heightPx,offsetX:minX,offsetY:minY,pieces:arts});
    }
  }
  for (const id of expected.keys()) {
  if (!seen.has(id)) {
    errors.push(
      'Falta pieza solicitada: ' + id,
    );
  }
}

for (const [definitionId, copies] of extraCopies) {
  const sorted = [...copies].sort((a, b) => a - b);
  if (sorted.some((index, position) => index !== position)) {
    errors.push('Índices de relleno incompletos: ' + definitionId);
  }
}

if (!layouts.length) {
  errors.push('No hay canvas exportables.');
}

const deduplicatedLayouts =
  errors.length === 0
    ? deduplicateExportLayouts(layouts)
    : layouts;

return {
  errors: [...new Set(errors)],
  warnings: [...new Set(warnings)],
  layouts: deduplicatedLayouts,
};
}
