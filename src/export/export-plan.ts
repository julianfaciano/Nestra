import { pieceDefinitionLabel, type BatchPieceDefinition } from '../domain/production-batch';
import type { CanvasProfile } from '../domain/canvas-profile';
import { expandPieceDefinitions } from '../domain/piece-instance';
import { getAllowedRotationsForPiece } from '../domain/piece-rotation';
import type { Polygon } from '../geometry/polygon';
import type { MultiNestingLayout } from '../geometry/multi-piece-nesting-engine';
import { getPolygonBounds, rotatePoint, transformPolygon, type PolygonBounds, type PolygonPlacement } from '../geometry/polygon-transform';
import { componentsOverlap } from '../geometry/polygon-components';
import { polygonFitsInsideCanvas } from '../geometry/canvas-geometry';
import { artworkBounds } from '../geometry/artwork-bounds';
import { extraPieceId, type ExtraPieceIdentity } from '../geometry/filler-types';
import type { AlphaPixelBounds } from '../geometry/alpha-polygon';

export const EXPORT_PPI = 300;
export const PX_PER_MM = EXPORT_PPI / 25.4;
export const PRODUCTIVE_CANVAS_WIDTH_MM = 1480;
export interface FabricBatchResult {
  readonly fabric: string;
  readonly layouts: readonly MultiNestingLayout[];
  readonly unplacedPieceIds: readonly string[];
  readonly elapsedMs: number;
}
export interface PreparedBatch {
  readonly definitions: readonly BatchPieceDefinition[];
  readonly polygons: ReadonlyMap<string, Polygon>;
  readonly collisionPolygons?: ReadonlyMap<string, Polygon>;
  readonly sourceAlphaBounds?: ReadonlyMap<string, AlphaPixelBounds>;
  readonly sourcePlacementBounds?: ReadonlyMap<string, AlphaPixelBounds>;
  readonly results: readonly FabricBatchResult[];
  readonly profile: CanvasProfile;
}
export interface SourceCrop {
  readonly xPx: number;
  readonly yPx: number;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly xMm: number;
  readonly yMm: number;
  readonly widthMm: number;
  readonly heightMm: number;
}
export interface ArtworkPlacement {
  readonly extra?: ExtraPieceIdentity;
  readonly definition: BatchPieceDefinition;
  readonly placement: PolygonPlacement;
  readonly translateX: number;
  readonly translateY: number;
  readonly sourceCrop?: SourceCrop;
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
  readonly boundsIssues: readonly PreflightBoundsIssue[];
}
export interface PreflightBoundsIssue {
  readonly kind: 'visible-bounds-overflow';
  readonly message: string;
  readonly fabric: string;
  readonly canvasIndex: number;
  readonly instanceId: string;
  readonly definitionId: string;
  readonly design: string;
  readonly size?: string;
  readonly side?: 'front' | 'back';
  readonly rotation: PolygonPlacement['rotation'];
  readonly placement: Pick<PolygonPlacement, 'x' | 'y'>;
  readonly sourceDimensionsPx: { readonly width: number; readonly height: number };
  readonly sourceAlphaBoundsPx: AlphaPixelBounds;
  readonly sourceAlphaBoundsMm: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly drawBoundsMm: PolygonBounds;
  readonly canvasBoundsMm: PolygonBounds;
  readonly overflowMm: {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
  };
}

const BOUNDS_EPSILON_MM = 1e-7;

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

function sourceCropForDefinition(
  definition: BatchPieceDefinition,
  bounds?: AlphaPixelBounds,
): SourceCrop {
  const pixelBounds = bounds ?? {
    x: 0,
    y: 0,
    width: definition.sourceWidthPx,
    height: definition.sourceHeightPx,
  };
  const valid =
    [pixelBounds.x, pixelBounds.y, pixelBounds.width, pixelBounds.height]
      .every(Number.isFinite) &&
    Number.isInteger(pixelBounds.x) &&
    Number.isInteger(pixelBounds.y) &&
    Number.isInteger(pixelBounds.width) &&
    Number.isInteger(pixelBounds.height) &&
    pixelBounds.x >= 0 &&
    pixelBounds.y >= 0 &&
    pixelBounds.width > 0 &&
    pixelBounds.height > 0 &&
    pixelBounds.x + pixelBounds.width <= definition.sourceWidthPx &&
    pixelBounds.y + pixelBounds.height <= definition.sourceHeightPx;

  if (!valid) {
    throw new Error('Bounds alpha inválidos: ' + pieceDefinitionLabel(definition));
  }

  const scaleX = definition.physicalWidthMm / definition.sourceWidthPx;
  const scaleY = definition.physicalHeightMm / definition.sourceHeightPx;
  return {
    xPx: pixelBounds.x,
    yPx: pixelBounds.y,
    widthPx: pixelBounds.width,
    heightPx: pixelBounds.height,
    xMm: pixelBounds.x * scaleX,
    yMm: pixelBounds.y * scaleY,
    widthMm: pixelBounds.width * scaleX,
    heightMm: pixelBounds.height * scaleY,
  };
}

function placedSourceCropBounds(
  crop: SourceCrop,
  placement: PolygonPlacement,
  translateX: number,
  translateY: number,
) {
  return getPolygonBounds(
    [
      { x: crop.xMm, y: crop.yMm },
      { x: crop.xMm + crop.widthMm, y: crop.yMm },
      { x: crop.xMm + crop.widthMm, y: crop.yMm + crop.heightMm },
      { x: crop.xMm, y: crop.yMm + crop.heightMm },
    ].map((point) => {
      const rotated = rotatePoint(point, placement.rotation);
      return { x: rotated.x + translateX, y: rotated.y + translateY };
    }),
  );
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

interface PlacedArtworkBounds {
  readonly pieceId: string;
  readonly art: ArtworkPlacement;
  readonly crop: SourceCrop;
  readonly bounds: PolygonBounds;
}

function physicalCanvasBounds(profile: CanvasProfile): PolygonBounds {
  return {
    minX: 0,
    minY: 0,
    maxX: PRODUCTIVE_CANVAS_WIDTH_MM,
    maxY: profile.maxHeight,
    width: PRODUCTIVE_CANVAS_WIDTH_MM,
    height: profile.maxHeight,
  };
}

function visibleOverflow(
  bounds: PolygonBounds,
  canvas: PolygonBounds,
): PreflightBoundsIssue['overflowMm'] {
  return {
    left: Math.max(0, canvas.minX - bounds.minX),
    right: Math.max(0, bounds.maxX - canvas.maxX),
    top: Math.max(0, canvas.minY - bounds.minY),
    bottom: Math.max(0, bounds.maxY - canvas.maxY),
  };
}

function dominantOverflow(
  overflow: PreflightBoundsIssue['overflowMm'],
): { readonly edge: 'izquierdo' | 'derecho' | 'superior' | 'inferior'; readonly mm: number } {
  const entries = [
    { edge: 'izquierdo' as const, mm: overflow.left },
    { edge: 'derecho' as const, mm: overflow.right },
    { edge: 'superior' as const, mm: overflow.top },
    { edge: 'inferior' as const, mm: overflow.bottom },
  ];
  return entries.reduce((largest, current) => current.mm > largest.mm ? current : largest);
}

function pieceIdentity(definition: BatchPieceDefinition): string {
  if (definition.kind === 'free-png') return definition.fileName;
  return `${definition.model} · ${definition.size} · ${definition.side === 'front' ? 'FRENTE' : 'DORSO'}`;
}

function createBoundsIssue(
  fabric: string,
  layoutIndex: number,
  record: PlacedArtworkBounds,
  profile: CanvasProfile,
): PreflightBoundsIssue {
  const { art, crop, bounds, pieceId } = record;
  const canvasBoundsMm = physicalCanvasBounds(profile);
  const overflowMm = visibleOverflow(bounds, canvasBoundsMm);
  const dominant = dominantOverflow(overflowMm);
  const definition = art.definition;
  const message =
    `Canvas ${layoutIndex + 1} · ${pieceIdentity(definition)}: ` +
    `el contenido visible excede ${dominant.mm.toLocaleString('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 3,
    })} mm por el borde ${dominant.edge}.`;

  return {
    kind: 'visible-bounds-overflow',
    message,
    fabric,
    canvasIndex: layoutIndex + 1,
    instanceId: pieceId,
    definitionId: definition.id,
    design: pieceDefinitionLabel(definition),
    ...(definition.kind === 'garment'
      ? { size: definition.size, side: definition.side }
      : {}),
    rotation: art.placement.rotation,
    placement: { x: art.placement.x, y: art.placement.y },
    sourceDimensionsPx: {
      width: definition.sourceWidthPx,
      height: definition.sourceHeightPx,
    },
    sourceAlphaBoundsPx: {
      x: crop.xPx,
      y: crop.yPx,
      width: crop.widthPx,
      height: crop.heightPx,
    },
    sourceAlphaBoundsMm: {
      x: crop.xMm,
      y: crop.yMm,
      width: crop.widthMm,
      height: crop.heightMm,
    },
    drawBoundsMm: bounds,
    canvasBoundsMm,
    overflowMm,
  };
}

export function preflightBatch(batch: PreparedBatch): PreflightReport {
  const errors: string[] = [];
  const boundsIssues: PreflightBoundsIssue[] = [];
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
  if (errors.length) return { errors, warnings, layouts, boundsIssues };
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
      const artworkBoundsRecords: PlacedArtworkBounds[] = [];
      const actualPolygons: (readonly Polygon[])[] = [];
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
        const collisionPolygon =
          batch.collisionPolygons?.get(d.id) ?? polygon;
        const transformedCollision = transformPolygon(
          collisionPolygon,
          piece.placement,
        );
        if (piece.extra && !polygonFitsInsideCanvas(transformed, { width: profile.maxWidth, height: requiredHeight })) {
          errors.push('Relleno fuera de la altura requerida: ' + piece.pieceId);
        }
        actualPolygons.push(
          piece.collisionComponents ?? [transformedCollision],
        );
        if (!polygonFitsInsideCanvas(transformed, { width: profile.maxWidth, height: profile.maxHeight })) errors.push('Pieza fuera del canvas: ' + piece.pieceId);
        let sourceCrop: SourceCrop;
        let tx: number;
        let ty: number;
        try {
          sourceCrop = sourceCropForDefinition(
            d,
            batch.sourceAlphaBounds?.get(d.id),
          );
          const sourcePlacementBounds = batch.sourcePlacementBounds?.get(d.id);
          if (sourcePlacementBounds) {
            const placementAnchor = sourceCropForDefinition(
              d,
              sourcePlacementBounds,
            );
            const rotatedAnchor = placedSourceCropBounds(
              placementAnchor,
              piece.placement,
              0,
              0,
            );
            tx = piece.placement.x - rotatedAnchor.minX;
            ty = piece.placement.y - rotatedAnchor.minY;
          } else {
            const rotated = getPolygonBounds(
              polygon.map((point) =>
                rotatePoint(point, piece.placement.rotation),
              ),
            );
            tx = piece.placement.x - rotated.minX;
            ty = piece.placement.y - rotated.minY;
          }
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
          continue;
        }
        const bounds = placedSourceCropBounds(
          sourceCrop,
          piece.placement,
          tx,
          ty,
        );
        if (piece.extra && (bounds.minY < requiredMinY || bounds.maxY > requiredMaxY)) {
          errors.push('El PNG de relleno aumenta la altura del PDF: ' + piece.pieceId);
        }
        minX = Math.min(minX, bounds.minX); minY = Math.min(minY, bounds.minY);
        maxX = Math.max(maxX, bounds.maxX); maxY = Math.max(maxY, bounds.maxY);
        const art: ArtworkPlacement = { definition:d, placement:piece.placement, translateX:tx, translateY:ty, sourceCrop, ...(piece.extra ? { extra: piece.extra } : {}) };
        arts.push(art);
        artworkBoundsRecords.push({
          pieceId: piece.pieceId,
          art,
          crop: sourceCrop,
          bounds,
        });
      }
      for (let a = 0; a < actualPolygons.length; a++) for (let b = a+1; b < actualPolygons.length; b++) {
        if (componentsOverlap(actualPolygons[a]!, actualPolygons[b]!)) errors.push(result.fabric + ': colisión en canvas ' + (layout.index + 1));
      }
      // Keep the productive width fixed. The crop uses the same printable-alpha
      // threshold as nesting and still envelopes every island above that threshold.
      const contentWidthMm = maxX - minX;
      const widthMm = PRODUCTIVE_CANVAS_WIDTH_MM, heightMm = maxY - minY;
      const offsetX = minX < 0 ? minX : Math.max(0, maxX - widthMm);
      if (!(contentWidthMm > 0 && heightMm > 0)) {
        errors.push(`Canvas ${layout.index + 1}: dimensiones visibles inválidas.`);
        continue;
      }
      if (contentWidthMm > widthMm + BOUNDS_EPSILON_MM || heightMm > profile.maxHeight + BOUNDS_EPSILON_MM) {
        const issues = artworkBoundsRecords
          .map((record) => createBoundsIssue(result.fabric, layout.index, record, profile))
          .filter((issue) => Math.max(
            issue.overflowMm.left,
            issue.overflowMm.right,
            issue.overflowMm.top,
            issue.overflowMm.bottom,
          ) > BOUNDS_EPSILON_MM);
        if (issues.length) {
          for (const issue of issues) {
            boundsIssues.push(issue);
            errors.push(issue.message);
          }
        } else {
          errors.push(
            `Canvas ${layout.index + 1}: el contenido visible excede el perfil físico.`,
          );
        }
        continue;
      }
      const base = fabricSlug(result.fabric);
      const index = names.get(base) ?? 0; names.set(base, index+1);
      const widthPx = Math.max(1, Math.round(widthMm * PX_PER_MM));
      const heightPx = Math.max(1, Math.round(heightMm * PX_PER_MM));
      if (widthPx > Math.floor(PRODUCTIVE_CANVAS_WIDTH_MM * PX_PER_MM) || heightPx > Math.floor(profile.maxHeight * PX_PER_MM)) {
        errors.push('El redondeo raster excede el perfil; dejá al menos 0,1 mm de margen.'); continue;
      }
      layouts.push({name: base + '_1_copia' + letterSuffix(index) + '.png', fabric:result.fabric, widthMm,heightMm,widthPx,heightPx,offsetX,offsetY:minY,pieces:arts});
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
  boundsIssues,
};
}
