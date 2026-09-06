import {
  createNestingProfile,
  startBlock,
  endBlock,
  finishProfile,
  type NestingProfile,
} from './nesting-profiler';
import { polygonFitsInsideCanvas } from './canvas-geometry';
import type { Polygon } from './polygon';
import { polygonsTouch } from './polygon-contact';
import { artworkBounds, prepareArtworkBounds, placeArtworkBounds } from './artwork-bounds';
import { extraPieceId, type ExtraPieceIdentity, type FillerRequest } from './filler-types';
import { boundsOverlapWithArea, polygonsOverlap } from './polygon-collision';
import {
  getPolygonBounds,
  transformPolygon,
  type PolygonBounds,
  type PieceRotation,
  type PolygonPlacement,
} from './polygon-transform';

export interface MultiNestingPiece {
  readonly kind?: 'garment' | 'free-png';
  readonly id: string;
  readonly polygon: Polygon;
  readonly finePolygon?: Polygon;
  readonly allowedRotations: readonly PieceRotation[];
  readonly artworkSize?: { readonly width: number; readonly height: number };
}

export interface MultiNestingCanvas {
  readonly width: number;
  readonly height: number;
}

export interface MultiNestingInput {
  /** One request per free PNG, scoped to this Worker's fabric by the caller. */
  readonly fillers?: readonly FillerRequest[];
  readonly pieces: readonly MultiNestingPiece[];
  readonly canvas: MultiNestingCanvas;
  readonly scanStepMm?: number;
  /** Temporary profiling; Worker defaults to true, direct calls to false. */
  readonly diagnosticProfiling?: boolean;
}

export interface MultiNestedPiece {
  /** Absent for existing required instances; never changes their identity. */
  readonly extra?: ExtraPieceIdentity;
  readonly pieceId: string;
  readonly placement: PolygonPlacement;
  readonly polygon: Polygon;
}

export interface MultiNestingLayout {
  readonly requiredUsedHeight?: number;
  readonly index: number;
  readonly pieces: readonly MultiNestedPiece[];
  readonly usedWidth: number;
  readonly usedHeight: number;
}

export interface MultiNestingResult {
  /** placedCount/totalPieceCount retain their required-piece meaning. */
  readonly extraCount?: number;
  readonly layouts: readonly MultiNestingLayout[];
  readonly unplacedPieceIds: readonly string[];
  readonly placedCount: number;
  readonly totalPieceCount: number;
  readonly diagnostics?: NestingDiagnostics;
}

function validateInput(input: MultiNestingInput): void {
  if (
    !Number.isFinite(input.canvas.width) ||
    input.canvas.width <= 0 ||
    !Number.isFinite(input.canvas.height) ||
    input.canvas.height <= 0
  ) {
    throw new Error('Las dimensiones del canvas deben ser mayores que cero.');
  }

  const scanStepMm = input.scanStepMm ?? 10;

  if (!Number.isFinite(scanStepMm) || scanStepMm <= 0) {
    throw new Error('La resolución de búsqueda debe ser mayor que cero.');
  }

  for (const piece of input.pieces) {
    if (piece.id.trim().length === 0) {
      throw new Error('Todas las piezas deben tener un identificador.');
    }

    if (piece.polygon.length < 3) {
      throw new Error(`La pieza ${piece.id} debe tener al menos 3 puntos.`);
    }

    if (piece.allowedRotations.length === 0) {
      throw new Error(
        `La pieza ${piece.id} debe tener al menos una rotación permitida.`,
      );
    }
  }
}

/** Counts actual work, excluding candidates skipped by the monotone rejection cache. */
export interface NestingDiagnostics {
  profile?: NestingProfile;
  candidatePlacementsTested: number;
  /** Full rotation/normalization operations (one per distinct geometry and rotation). */
  polygonTransforms: number;
  polygonTranslations: number;
  broadPhaseChecks: number;
  exactPolygonCollisionChecks: number;
  layoutsCreated: number;
  placedCount: number;
  candidateCacheHits: number;
}

interface Variant {
  readonly polygon: Polygon;
  readonly bounds: PolygonBounds;
  readonly finePolygon: Polygon;
  readonly fineBounds: PolygonBounds;
  readonly rotation: PieceRotation;
}

interface InternalPiece extends MultiNestedPiece {
  readonly kind?: 'garment' | 'free-png';
  readonly bounds: PolygonBounds;
  readonly finePolygon: Polygon;
  readonly fineBounds: PolygonBounds;
  readonly bucketBounds: PolygonBounds;
}
interface MutableLayout {
  readonly pieces: InternalPiece[];
  readonly buckets: Map<string, InternalPiece[]>;
  readonly rejected: Map<Variant, Set<string>>;
  usedWidth: number;
  usedHeight: number;
}

// Index cells include boundaries: extra neighbors are harmless; missing one is not.
const CELL_MM = 200;
function cellKeys(bounds: PolygonBounds): string[] {
  const keys: string[] = [];
  for (
    let y = Math.floor(bounds.minY / CELL_MM);
    y <= Math.floor(bounds.maxY / CELL_MM);
    y++
  ) {
    for (
      let x = Math.floor(bounds.minX / CELL_MM);
      x <= Math.floor(bounds.maxX / CELL_MM);
      x++
    ) {
      keys.push(`${x},${y}`);
    }
  }
  return keys;
}

function unionBounds(
  first: PolygonBounds,
  second: PolygonBounds,
): PolygonBounds {
  const minX = Math.min(first.minX, second.minX);
  const minY = Math.min(first.minY, second.minY);
  const maxX = Math.max(first.maxX, second.maxX);
  const maxY = Math.max(first.maxY, second.maxY);

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function addPiece(layout: MutableLayout, piece: InternalPiece): void {
  layout.pieces.push(piece);
  layout.usedWidth = Math.max(layout.usedWidth, piece.bounds.maxX);
  layout.usedHeight = Math.max(layout.usedHeight, piece.bounds.maxY);
  for (const key of cellKeys(piece.bucketBounds)) {
    const bucket = layout.buckets.get(key) ?? [];
    bucket.push(piece);
    layout.buckets.set(key, bucket);
  }
}

function findPlacementInLayout(
  variants: readonly Variant[],
  layout: MutableLayout,
  canvas: MultiNestingCanvas,
  step: number,
  diagnostics: NestingDiagnostics,
  accepts?: (placement: PolygonPlacement, variant: Variant) => boolean,
  preferContact = false,
): Omit<InternalPiece, 'pieceId'> | null {
  const profile = diagnostics.profile;
  const coordinatesStart = startBlock(profile, 'candidateCoordinates');
  // Cross edge coordinates so a right edge and a top edge from different pieces
  // can define a cavity. Both floor and ceil retain grid alignments on either side.
  const xs = new Set<number>([0]);
  const ys = new Set<number>([0]);
  const add = (set: Set<number>, value: number, limit: number) => {
    if (preferContact && value >= 0 && value <= limit) set.add(value);
    for (const coordinate of [
      Math.floor(value / step) * step,
      Math.ceil(value / step) * step,
    ]) {
      if (coordinate >= 0 && coordinate <= limit) set.add(coordinate);
    }
  };
  const searchTop = Math.ceil(layout.usedHeight / step) * step;
  for (const variant of variants) {
    add(xs, canvas.width - variant.bounds.width, canvas.width);
    for (const { bounds } of layout.pieces) {
      for (const edge of [bounds.minX, bounds.maxX]) {
        add(xs, edge, canvas.width);
        add(xs, edge - variant.bounds.width, canvas.width);
      }
      for (const edge of [bounds.minY, bounds.maxY]) {
        add(ys, edge, searchTop);
        add(ys, edge - variant.bounds.height, searchTop);
      }
    }
  }
  if (accepts) {
    // Fill phase must exhaust the available grid, including gaps between fast/fine edges.
    // Candidate evaluation below is the SAME canvas/broad-phase/exact collision pipeline.
    const columns = Math.floor(canvas.width / step);
    const rows = Math.floor(canvas.height / step);
    if (!Number.isSafeInteger(columns) || !Number.isSafeInteger(rows)) throw new Error('Resolución de relleno fuera de rango.');
    for (let column = 0; column <= columns; column++) xs.add(column * step);
    for (let row = 0; row <= rows; row++) ys.add(row * step);
  }
  const orderedX = [...xs].sort((a, b) => a - b);
  const orderedY = [...ys].sort((a, b) => a - b);
  endBlock(profile, 'candidateCoordinates', coordinatesStart);
  if (profile) {
    profile.counters.coordinateSets++;
    profile.counters.xCoordinates += orderedX.length;
    profile.counters.yCoordinates += orderedY.length;
  }
  const variantStates = variants.map((variant) => {
  const existing = layout.rejected.get(variant);

  if (existing) {
    return {
      variant,
      rejected: existing,
    };
  }

  const rejected = new Set<string>();

  layout.rejected.set(variant, rejected);

  return {
    variant,
    rejected,
  };
});

let best: Omit<InternalPiece, 'pieceId'> | null = null;
let bestScore: number[] | undefined;
function* candidates() {
for (const y of orderedY) {
  for (const x of orderedX) {
    for (const { variant, rejected } of variantStates) {
      yield { x, y, variant, rejected };
    }
  }
}
if (preferContact) {
  for (const { variant, rejected } of variantStates) {
    const seen = new Set<string>();
    for (const neighbor of layout.pieces) {
      for (const a of neighbor.finePolygon) for (const b of variant.finePolygon) {
        const x = a.x - b.x;
        const y = a.y - b.y;
        const key = `${x},${y}`;
        if (x < 0 || y < 0 || x + variant.fineBounds.width > canvas.width || y + variant.fineBounds.height > canvas.height || seen.has(key)) continue;
        seen.add(key);
        yield { x, y, variant, rejected };
      }
    }
  }
}
}
for (const { x, y, variant, rejected } of candidates()) {
    const key = `${x},${y}`;
      const cacheStart = startBlock(profile, 'rejectionCache');
      const cacheHit = rejected.has(key);
      endBlock(profile, 'rejectionCache', cacheStart);

      if (profile) {
        profile.counters.rejectionCacheLookups++;

        if (cacheHit) {
          profile.counters.rejectionCacheHits++;
        }
      }

      if (cacheHit) {
        diagnostics.candidateCacheHits++;
        continue;
      }
        diagnostics.candidatePlacementsTested++;
        const boundsStart = startBlock(profile, 'candidateBounds');
        const bounds: PolygonBounds = {
          minX: x,
          minY: y,
          maxX: x + variant.bounds.width,
          maxY: y + variant.bounds.height,
          width: variant.bounds.width,
          height: variant.bounds.height,
        };
        endBlock(profile, 'candidateBounds', boundsStart);
        if (accepts && !accepts({ x, y, rotation: variant.rotation }, variant)) {
          rejected.add(key);
          continue;
        }
        if (
          bounds.maxX > canvas.width + 1e-9 ||
          bounds.maxY > canvas.height + 1e-9
        ) {
          rejected.add(key);
          continue;
        }
        // Translation only; the normalized rotation is shared by all instances.
const polygonStart = startBlock(profile, 'candidatePolygon');

const polygon = variant.polygon.map((point) => ({
  x: point.x + x,
  y: point.y + y,
}));

endBlock(profile, 'candidatePolygon', polygonStart);
diagnostics.polygonTranslations++;

const fitStart = startBlock(profile, 'canvasFit');
const fits = polygonFitsInsideCanvas(polygon, canvas);
endBlock(profile, 'canvasFit', fitStart);

if (!fits) {
  rejected.add(key);
  continue;
}
        const neighborsStart = startBlock(profile, 'neighborLookup');
        const neighbors = new Set<InternalPiece>();
        for (const cell of cellKeys(bounds)) {
          if (profile) {
            profile.counters.cellKeys++;
            profile.counters.bucketLookups++;
          }
          for (const neighbor of layout.buckets.get(cell) ?? []) {
            if (profile) profile.counters.neighborCandidates++;
            neighbors.add(neighbor);
          }
        }
        endBlock(profile, 'neighborLookup', neighborsStart);
        if (profile) {
          profile.counters.uniqueNeighbors += neighbors.size;
          // Cumulative references minus cumulative unique neighbors, no extra Set.has.
          profile.counters.neighborDuplicates =
            profile.counters.neighborCandidates -
            profile.counters.uniqueNeighbors;
        }
        let collision = false;
        for (const neighbor of neighbors) {
          diagnostics.broadPhaseChecks++;
          const broadStart = startBlock(profile, 'boundsOverlap');
          const overlaps = boundsOverlapWithArea(bounds, neighbor.bounds);
endBlock(profile, 'boundsOverlap', broadStart);

if (!overlaps) {
  continue;
}

diagnostics.exactPolygonCollisionChecks++;
          const collisionStart = startBlock(profile, 'polygonsOverlap');
          const overlapsPolygon = polygonsOverlap(
  polygon,
  neighbor.polygon,
  bounds,
  neighbor.bounds,
);
          endBlock(profile, 'polygonsOverlap', collisionStart);
          if (overlapsPolygon) {
            collision = true;
            break;
          }
        }
        if (!collision) {

  const finePolygon = variant.finePolygon.map((point) => ({
    x: point.x + x,
    y: point.y + y,
  }));

  const fineBounds: PolygonBounds = {
    minX: x,
    minY: y,
    maxX: x + variant.fineBounds.width,
    maxY: y + variant.fineBounds.height,
    width: variant.fineBounds.width,
    height: variant.fineBounds.height,
  };

  if (
    fineBounds.maxX > canvas.width + 1e-9 ||
    fineBounds.maxY > canvas.height + 1e-9 ||
    !polygonFitsInsideCanvas(finePolygon, canvas)
  ) {
    rejected.add(key);
    continue;
  }

  const fineNeighbors = new Set<InternalPiece>();

  for (const cell of cellKeys(fineBounds)) {
    for (const neighbor of layout.buckets.get(cell) ?? []) {
      fineNeighbors.add(neighbor);
    }
  }

  let fineCollision = false;

  for (const neighbor of fineNeighbors) {
    if (!boundsOverlapWithArea(fineBounds, neighbor.fineBounds)) {
      continue;
    }

    if (
      polygonsOverlap(
        finePolygon,
        neighbor.finePolygon,
        fineBounds,
        neighbor.fineBounds,
      )
    ) {
      fineCollision = true;
      break;
    }
  }

  if (!fineCollision) {
    const candidate = {
      polygon,
      bounds,
      finePolygon,
      fineBounds,
      bucketBounds: unionBounds(bounds, fineBounds),
      placement: { x, y, rotation: variant.rotation },
    };
    if (!preferContact) return candidate;
    let garments = 0;
    let others = 0;
    for (const neighbor of fineNeighbors) {
      if (polygonsTouch(finePolygon, neighbor.finePolygon)) {
        if (neighbor.kind === 'garment') garments++;
        else others++;
      }
    }
    const score = [-garments, -others, Math.max(layout.usedHeight, bounds.maxY), y, x];
    const difference = bestScore ? score.findIndex((value, index) => value !== bestScore![index]) : -1;
    if (!bestScore || (difference >= 0 && score[difference]! < bestScore[difference]!)) {
      best = candidate;
      bestScore = score;
    }
    continue;
  }
}

// Layouts only gain pieces: a collision cannot become valid later.
rejected.add(key);
  }
  return best;
}

export function nestMultiplePieces(
  input: MultiNestingInput,
): MultiNestingResult {
  const profile = input.diagnosticProfiling
    ? createNestingProfile()
    : undefined;
  const engineStart = profile ? performance.now() : 0;
  validateInput(input);
  const diagnostics: NestingDiagnostics = {
    candidatePlacementsTested: 0,
    polygonTransforms: 0,
    polygonTranslations: 0,
    broadPhaseChecks: 0,
    exactPolygonCollisionChecks: 0,
    layoutsCreated: 0,
    placedCount: 0,
    candidateCacheHits: 0,
  };
  if (profile) diagnostics.profile = profile;
  const preparationStart = startBlock(profile, 'preparation');
  // Value keys also deduplicate separately allocated definitions / worker clones.
  // Local to this run: no stale geometry after edits and no cross-job retention.
  const geometry = new Map<
    string,
    { area: number; rotations: Map<PieceRotation, Variant> }
  >();
  const prepared = input.pieces
    .map((piece) => {
      const fineSourcePolygon = piece.finePolygon ?? piece.polygon;

const key = JSON.stringify([
  piece.polygon.map((point) => [point.x, point.y]),
  fineSourcePolygon.map((point) => [point.x, point.y]),
]);
      let cached = geometry.get(key);
      if (!cached) {
        const bounds = getPolygonBounds(piece.polygon);
        cached = { area: bounds.width * bounds.height, rotations: new Map() };
        geometry.set(key, cached);
      }
      const variants = piece.allowedRotations
        .map((rotation) => {
          let variant = cached.rotations.get(rotation);
          if (!variant) {
  const polygon = transformPolygon(piece.polygon, {
    x: 0,
    y: 0,
    rotation,
  });

  const finePolygon = transformPolygon(fineSourcePolygon, {
    x: 0,
    y: 0,
    rotation,
  });

  diagnostics.polygonTransforms++;

  variant = {
    polygon,
    bounds: getPolygonBounds(polygon),
    finePolygon,
    fineBounds: getPolygonBounds(finePolygon),
    rotation,
  };

  cached.rotations.set(rotation, variant);
}
          return variant;
        })
        .filter(
          (variant) =>
            variant.bounds.width <= input.canvas.width + 1e-9 &&
            variant.bounds.height <= input.canvas.height + 1e-9,
        );
      return { piece, variants, area: cached.area };
    })
    .sort((a, b) => b.area - a.area);
  endBlock(profile, 'preparation', preparationStart);
  const layouts: MutableLayout[] = [];
  const unplacedPieceIds: string[] = [];
  for (const { piece, variants } of prepared) {
    if (!variants.length) {
      unplacedPieceIds.push(piece.id);
      continue;
    }
    let placed = false;
    for (const layout of layouts) {
      const result = findPlacementInLayout(
        variants,
        layout,
        input.canvas,
        input.scanStepMm ?? 10,
        diagnostics,
        undefined,
        piece.kind === 'garment' && layout.pieces.length > 0,
      );
      if (result) {
        addPiece(layout, { ...result, pieceId: piece.id, ...(piece.kind ? { kind: piece.kind } : {}) });
        placed = true;
        break;
      }
    }
    if (!placed) {
      const layout: MutableLayout = {
        pieces: [],
        buckets: new Map(),
        rejected: new Map(),
        usedWidth: 0,
        usedHeight: 0,
      };
      const result = findPlacementInLayout(
        variants,
        layout,
        input.canvas,
        input.scanStepMm ?? 10,
        diagnostics,
      );
      if (!result) {
        unplacedPieceIds.push(piece.id);
        continue;
      }
      addPiece(layout, { ...result, pieceId: piece.id, ...(piece.kind ? { kind: piece.kind } : {}) });
      layouts.push(layout);
      diagnostics.layoutsCreated++;
    }
    diagnostics.placedCount++;
  }
  // Phase 2 starts only after phase 1 is complete. It never enters the new-layout path.
  const requiredHeights = layouts.map(layout => layout.usedHeight);
  let extraCount = 0;
  if (input.fillers?.length && unplacedPieceIds.length === 0) {
    const sourceById = new Map(prepared.map(entry => [entry.piece.id, entry]));
    const identities = new Set(input.pieces.map(piece => piece.id));
    const requestedDefinitions = new Set<string>();
    const materialBounds = layouts.map(layout => {
      let full: PolygonBounds | undefined;
      for (const placed of layout.pieces) {
        const source = sourceById.get(placed.pieceId)!.piece;
        const bounds = source.artworkSize
          ? artworkBounds(source.polygon, placed.placement, source.artworkSize)
          : placed.bounds;
        full = full ? unionBounds(full, bounds) : bounds;
      }
      return full!;
    });
    const activeFillers = [...input.fillers]
      .sort((a, b) => a.priority - b.priority)
      .map((filler) => {
      if (!Number.isSafeInteger(filler.priority) || filler.priority < 1 || requestedDefinitions.has(filler.definitionId)) {
        throw new Error('Prioridad o definición de relleno inválida.');
      }
      requestedDefinitions.add(filler.definitionId);
      const source = sourceById.get(filler.requiredPieceId);
      if (!source) throw new Error('El relleno no tiene una pieza requerida en esta tela.');
      // Zero-area/degenerate contours cannot consume space and must never drive an unbounded loop.
      const variants = source.variants.filter(variant =>
        variant.polygon.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)) &&
        variant.bounds.width > 1e-9 &&
        variant.bounds.height > 1e-9);
      const artworkVariants = new Map(variants.flatMap(variant => source.piece.artworkSize
        ? [[variant.rotation, prepareArtworkBounds(source.piece.polygon, variant.rotation, source.piece.artworkSize)] as const]
        : []));
      const fullArtworkAt = (placement: PolygonPlacement): PolygonBounds | undefined => {
        const bounds = artworkVariants.get(placement.rotation);
        return bounds ? placeArtworkBounds(bounds, placement) : undefined;
      };
      return { filler, variants, fullArtworkAt, copyIndex: 0 };
    });

    for (const layout of layouts) layout.rejected.clear();
    const tryPlaceOne = (item: (typeof activeFillers)[number]): boolean => {
      const { filler, variants, fullArtworkAt } = item;
      const copyIndex = item.copyIndex;
      for (const [layoutIndex, layout] of layouts.entries()) {
        const height = requiredHeights[layoutIndex]!;
        let material = materialBounds[layoutIndex]!;
        const accepts = (placement: PolygonPlacement, variant: Variant) => {
          if (placement.y + Math.max(variant.bounds.height, variant.fineBounds.height) > height ||
              placement.x + Math.max(variant.bounds.width, variant.fineBounds.width) > input.canvas.width) return false;
          const full = fullArtworkAt(placement);
          if (!full) return true;
          return full.minY >= material.minY && full.maxY <= material.maxY &&
            Math.max(material.maxX, full.maxX) - Math.min(material.minX, full.minX) <= input.canvas.width;
        };
        const placement = findPlacementInLayout(
          variants,
          layout,
          { width: input.canvas.width, height },
          input.scanStepMm ?? 10,
          diagnostics,
          accepts,
        );
        if (!placement) continue;

        const pieceId = extraPieceId(filler.definitionId, copyIndex);
        if (!Number.isSafeInteger(copyIndex + 1) || identities.has(pieceId)) throw new Error('Identidad de relleno inválida.');
        identities.add(pieceId);
        addPiece(layout, { ...placement, pieceId, extra: { definitionId: filler.definitionId, copyIndex } });
        const full = fullArtworkAt(placement.placement);
        if (full) {
          material = unionBounds(material, full);
          materialBounds[layoutIndex] = material;
        }
        item.copyIndex = copyIndex + 1;
        extraCount++;
        return true;
      }
      return false;
    };

    // MAX fillers are exhausted one at a time before normal fillers enter the round-robin.
    for (const item of activeFillers.filter((candidate) => candidate.filler.mode === 'max')) {
      while (tryPlaceOne(item)) {
        // The successful placement changes the layout state, so the next attempt is new.
      }
    }

    let remaining = activeFillers.filter((candidate) => candidate.filler.mode === 'normal');
    while (remaining.length > 0) {
      let progress = false;
      const nextRemaining = [] as typeof remaining;
      for (const item of remaining) {
        if (tryPlaceOne(item)) {
          progress = true;
          nextRemaining.push(item);
        }
      }
      if (!progress) break;
      remaining = nextRemaining;
    }
  }
  const result: MultiNestingResult = {
    ...(input.fillers?.length ? { extraCount } : {}),
    layouts: layouts.map((layout, index) => ({
      ...(input.fillers?.length ? { requiredUsedHeight: requiredHeights[index]! } : {}),
      index,
      usedWidth: layout.usedWidth,
      usedHeight: layout.usedHeight,
      pieces: layout.pieces.map(({ pieceId, placement, polygon, extra }) => ({
        ...(extra ? { extra } : {}),
        pieceId,
        placement,
        polygon,
      })),
    })),
    unplacedPieceIds,
    placedCount: diagnostics.placedCount,
    totalPieceCount: input.pieces.length,
    diagnostics,
  };
  if (profile) finishProfile(profile, engineStart);
  return result;
}
