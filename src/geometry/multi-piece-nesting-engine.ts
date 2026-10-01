import { contoursViolateClearance } from './polygon-clearance';
import {
  createNestingProfile,
  startBlock,
  endBlock,
  finishProfile,
  type NestingProfile,
} from './nesting-profiler';
import { polygonFitsInsideCanvas } from './canvas-geometry';
import type { Polygon } from './polygon';
import { polygonsTouch, createIndexedPolygonTouch, localContourSnaps } from './polygon-contact';
import { componentEnvelope, transformComponents } from './polygon-components';
import { artworkBounds, prepareArtworkBounds, placeArtworkBounds } from './artwork-bounds';
import { extraPieceId, type ExtraPieceIdentity, type FillerRequest } from './filler-types';
import { boundsOverlapWithArea, boundsOverlapWithAreaTranslated, polygonsOverlap, createIndexedPolygonOverlap, createPolygonSegmentQuery, createPolygonCollisionDiagnostics, type PolygonCollisionDiagnostics } from './polygon-collision';
import {
  getPolygonBounds,
  rotatePoint,
  transformPolygon,
  type PolygonBounds,
  type PieceRotation,
  type PolygonPlacement,
} from './polygon-transform';

export interface MultiNestingPiece {
  /** Exact exterior alpha loops, independent of conservative garment collision. */
  readonly cutComponents?: readonly Polygon[];
  readonly cutAnchor?: Polygon;
  readonly collisionComponents?: readonly Polygon[];
  readonly kind?: 'garment' | 'free-png';
  readonly id: string;
  readonly polygon: Polygon;
  readonly finePolygon?: Polygon;
  readonly allowedRotations: readonly PieceRotation[];
  readonly artworkSize?: { readonly width: number; readonly height: number };
}

export interface MultiNestingCanvas {
  /** Minimum nominal cut-contour distance, including any centered-stroke width. */
  readonly minimumPieceClearance?: number;
  readonly outlineExtentMm?: number;
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
  /** Test/benchmark-only detailed REQUIRED search diagnostics. */
  readonly diagnosticRequiredScale?: boolean;
  /** Opt-in exact history tracking; retains emitted candidate keys for benchmarks only. */
  readonly diagnosticRequiredEnumeration?: boolean;
/** Lightweight phase timing: only two wall-clock measurements per run. */
readonly diagnosticPhaseTiming?: boolean;
}

export type NestingProgress =
  | { readonly phase: 'preparing' }
  | {
      readonly phase: 'required';
      readonly completed: number;
      readonly total: number;
    }
  | {
      readonly phase: 'fillers';
      readonly completed: number;
      readonly total: number;
    }
  | { readonly phase: 'finalizing' };

export interface MultiNestedPiece {
  readonly cutComponents?: readonly Polygon[];
  readonly collisionComponents?: readonly Polygon[];
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

  if (![input.canvas.minimumPieceClearance ?? 0, input.canvas.outlineExtentMm ?? 0].every(v => Number.isFinite(v) && v >= 0)) {
    throw new Error('Separación o contorno productivo inválido.');
  }
  const scanStepMm = input.scanStepMm ?? 10;

  if (!Number.isFinite(scanStepMm) || scanStepMm <= 0) {
    throw new Error('La resolución de búsqueda debe ser mayor que cero.');
  }

  for (const piece of input.pieces) {
    if (piece.cutComponents && (!piece.cutComponents.length || piece.cutComponents.some(p =>
      p.length < 3 || p.some(v => !Number.isFinite(v.x) || !Number.isFinite(v.y))))) {
      throw new Error('Contornos de corte inválidos.');
    }
    if (piece.collisionComponents && (!piece.collisionComponents.length || piece.collisionComponents.some(p =>
      p.length < 3 || p.some(v => !Number.isFinite(v.x) || !Number.isFinite(v.y))))) {
      throw new Error('Componentes de colisión inválidos.');
    }
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
  requiredPieces?: RequiredPieceDiagnostics[];
  polygonCollision: PolygonCollisionDiagnostics;
  requiredMs: number;
  fillerMs: number;
  requiredFailedVersionHits: number;
  candidatePlacementsTested: number;
  /** Full rotation/normalization operations (one per distinct geometry and rotation). */
  polygonTransforms: number;
  polygonTranslations: number;
  broadPhaseChecks: number;
  exactPolygonCollisionChecks: number;
  layoutsCreated: number;
  placedCount: number;
  candidateCacheHits: number;
  /** REQUIRED-only component geometry translations materialized for candidate offsets. */
  componentTranslations: number;
  /** Expanded REQUIRED instances carrying alpha collision components. */
  piecesUsingCollisionComponents: number;
  /** REQUIRED candidates that make at least one component-level overlap call. */
  candidatesEnteringComponentPath: number;
  /** REQUIRED component counters; pairs count only pairs reached before short-circuit. */
  componentsOverlapCalls: number;
  componentPairCandidates: number;
  componentPairAabbRejects: number;
  /** Component bounds rebuilt inside pair evaluation; excludes precomputed/cached bounds. */
  componentPairBoundsRecomputed: number;
  /** Per-component local AABBs created once for each geometry/rotation variant. */
  componentBoundsPrecomputations: number;
  componentPairExactChecks: number;
  componentPairExactCollisions: number;
  requiredSearchAttempts: number;
  requiredCandidateEnumerations: number;
  requiredCandidateFreshEnumerations: number;
  requiredCandidateHistoricalReenumerations: number;
  requiredDistinctHistoricalCandidates: number;
  requiredFirstSearchEnumerations: number;
  requiredFreshEmissionsFromPreviouslyExistingCoordinates: number;
  requiredSearchRestartsFromBeginning: number;
  requiredGridCandidatesEnumerated: number;
  requiredContactCandidatesEnumerated: number;
  requiredGridAndContactCandidatesEnumerated: number;
  requiredOtherCandidatesEnumerated: number;
  /** Duplicate X- or Y-axis coordinate proposals, counted before Set deduplication. */
  requiredDuplicateAxisCoordinateProposals: number;
  /** Duplicate X- or Y-axis coordinate proposals discarded by Set deduplication. */
  requiredDuplicateAxisCoordinateProposalsSkipped: number;
  /** Historical emitted candidates already rejected by the monotone cache. */
  requiredFrontierEligibleHistoricalCandidates: number;
  requiredCacheHitsWithoutSameIdentityHistory: number;
  /** Fresh emissions using an X or Y coordinate absent from the prior search. */
  requiredCandidateNewCoordinateEnumerations: number;
  requiredNewCoordinateGridCandidates: number;
  requiredNewCoordinateContactCandidates: number;
  requiredNewCoordinateGridAndContactCandidates: number;
  requiredNewCoordinateOtherCandidates: number;
  /** New coordinate combinations containing an axis coordinate derived from the newest layout piece. */
  requiredNewCoordinateCandidatesFromLastPiece: number;
  /** New coordinate combinations reusing an exact contact coordinate seen in earlier attempts. */
  requiredNewCoordinateCandidatesUsingExistingContacts: number;
  requiredHistoricalCandidateCacheHits: number;
  requiredEnumerationUniqueCandidates: number;
  requiredEnumerationMaxUniqueCandidatesPerSearchIdentityLayout: number;
  requiredEnumerationStates: number;
}

export interface RequiredLayoutAttemptDiagnostics {
  layoutIndex: number;
  piecesInLayout: number;
  variantsConsidered: number;
  xCoordinatesProposed: number;
  xCoordinatesUnique: number;
  yCoordinatesProposed: number;
  yCoordinatesUnique: number;
  candidateOpportunitiesPotential: number;
  candidateOpportunitiesEmitted: number;
  candidateCacheLookups: number;
  candidateCacheHits: number;
  candidatesPrunedBeforeTranslation: number;
  candidatesTranslated: number;
  bucketLookups: number;
  bucketReferences: number;
  uniqueNeighbors: number;
  broadPhaseChecks: number;
  exactCollisionChecks: number;
  contactChecks: number;
  elapsedMs: number;
  success: boolean;
}

export interface RequiredPieceDiagnostics {
  pieceIndex: number;
  pieceId: string;
  layoutsTried: number;
  successfulPlacements: number;
  elapsedMs: number;
  attempts: RequiredLayoutAttemptDiagnostics[];
}

interface Variant {
  readonly cutComponents?: readonly Polygon[];
  readonly collisionComponents?: readonly Polygon[];
  readonly collisionComponentBounds?: readonly PolygonBounds[];
  readonly polygon: Polygon;
  readonly bounds: PolygonBounds;
  readonly finePolygon: Polygon;
  readonly fineBounds: PolygonBounds;
  readonly rotation: PieceRotation;
}

interface InternalPiece extends MultiNestedPiece {
  readonly cutBounds?: PolygonBounds;
  readonly kind?: 'garment' | 'free-png';
  readonly bounds: PolygonBounds;
  readonly finePolygon: Polygon;
  readonly fineBounds: PolygonBounds;
  readonly bucketBounds: PolygonBounds;
  readonly collisionComponentBounds?: readonly PolygonBounds[];
}

function offsetBounds(bounds: PolygonBounds, x: number, y: number): PolygonBounds {
  return {
    minX: bounds.minX + x,
    minY: bounds.minY + y,
    maxX: bounds.maxX + x,
    maxY: bounds.maxY + y,
    width: bounds.width,
    height: bounds.height,
  };
}

function translatedComponentAt(
  source: readonly Polygon[],
  index: number,
  x: number,
  y: number,
  cache: (Polygon | undefined)[],
  diagnostics: NestingDiagnostics,
  collisionDiagnostics?: PolygonCollisionDiagnostics,
): Polygon {
  let polygon = cache[index];
  if (!polygon) {
    const sampleMaterialization = collisionDiagnostics !== undefined &&
      (collisionDiagnostics.exactCollisionTemporaryPolygonMaterializations & 127) === 0;
    const materializationStartedAt = sampleMaterialization ? performance.now() : 0;
    polygon = source[index]!.map(point => ({x: point.x + x, y: point.y + y}));
    cache[index] = polygon;
    diagnostics.componentTranslations++;
    if (collisionDiagnostics) {
      collisionDiagnostics.exactCollisionTemporaryPolygonMaterializations++;
      collisionDiagnostics.exactCollisionVerticesMaterialized += polygon.length;
      if (sampleMaterialization) {
        collisionDiagnostics.exactCollisionMaterializationSamples++;
        collisionDiagnostics.exactCollisionMaterializationSampledMs += performance.now() - materializationStartedAt;
      }
    }
  }
  return polygon;
}

function translatedComponentBoundsAt(
  source: readonly PolygonBounds[],
  index: number,
  x: number,
  y: number,
  cache: (PolygonBounds | undefined)[],
  diagnostics?: PolygonCollisionDiagnostics,
): PolygonBounds {
  let bounds = cache[index];
  if (!bounds) {
    bounds = offsetBounds(source[index]!, x, y);
    cache[index] = bounds;
    if (diagnostics) diagnostics.exactCollisionTranslatedBoundsMaterializations++;
  }
  return bounds;
}

/** Exact component overlap with cached local bounds and an offset for the moving piece. */
function componentsOverlapAtOffset(
  moving: readonly Polygon[],
  movingBounds: readonly PolygonBounds[],
  movingBoundsAreLocal: boolean,
  offsetX: number,
  offsetY: number,
  placed: readonly Polygon[],
  placedBounds: readonly PolygonBounds[],
  translatedMoving: (Polygon | undefined)[],
  translatedMovingBounds: (PolygonBounds | undefined)[],
  diagnostics: NestingDiagnostics,
  collisionDiagnostics?: PolygonCollisionDiagnostics,
): boolean {
  diagnostics.componentsOverlapCalls++;
  for (let i = 0; i < moving.length; i++) {
    for (let j = 0; j < placed.length; j++) {
      diagnostics.componentPairCandidates++;
      const boundsOverlap = movingBoundsAreLocal
        ? boundsOverlapWithAreaTranslated(movingBounds[i]!, offsetX, offsetY, placedBounds[j]!)
        : boundsOverlapWithArea(movingBounds[i]!, placedBounds[j]!);
      if (!boundsOverlap) {
        diagnostics.componentPairAabbRejects++;
        continue;
      }
      diagnostics.componentPairExactChecks++;
      const movingPolygon = movingBoundsAreLocal
        ? translatedComponentAt(moving, i, offsetX, offsetY, translatedMoving, diagnostics, collisionDiagnostics)
        : moving[i]!;
      const movingPolygonBounds = movingBoundsAreLocal
        ? translatedComponentBoundsAt(movingBounds, i, offsetX, offsetY, translatedMovingBounds, collisionDiagnostics)
        : movingBounds[i]!;
      if (polygonsOverlap(movingPolygon, placed[j]!, movingPolygonBounds, placedBounds[j]!, undefined, undefined, collisionDiagnostics)) {
        diagnostics.componentPairExactCollisions++;
        return true;
      }
    }
  }
  return false;
}
interface MutableLayout {
  readonly pieces: InternalPiece[];
  readonly buckets: Map<string, InternalPiece[]>;
  readonly rejected: Map<Variant, Set<string>>;
  readonly failedRequiredVersions: Map<object, number>;
  usedWidth: number;
  usedHeight: number;
}

interface RequiredEnumerationState {
  readonly emittedCandidates: Map<string, boolean>;
  readonly xCoordinates: Set<number>;
  readonly yCoordinates: Set<number>;
  readonly contactXCoordinates: Set<number>;
  readonly contactYCoordinates: Set<number>;
  attempts: number;
  lastVersion: number;
}

type RequiredEnumerationContext = WeakMap<MutableLayout, Map<object, RequiredEnumerationState>>;

function getRequiredEnumerationState(
  context: RequiredEnumerationContext,
  layout: MutableLayout,
  searchIdentity: object,
): RequiredEnumerationState {
  let byIdentity = context.get(layout);
  if (!byIdentity) {
    byIdentity = new Map();
    context.set(layout, byIdentity);
  }
  let state = byIdentity.get(searchIdentity);
  if (!state) {
    state = {
      emittedCandidates: new Map(),
      xCoordinates: new Set(),
      yCoordinates: new Set(),
      contactXCoordinates: new Set(),
      contactYCoordinates: new Set(),
      attempts: 0,
      lastVersion: -1,
    };
    byIdentity.set(searchIdentity, state);
  }
  return state;
}

interface FillerCandidate {
  x: number; y: number; variant: Variant; rejected: Set<string>;
  checkedPieces: number; contacts: number;
  neighbors: InternalPiece[];
  snapSource: boolean;
  snappedPieces: number;
}
interface FillerSearch {
  cursor: number;
  overlap: typeof polygonsOverlap;
  touch: ReturnType<typeof createIndexedPolygonTouch>;
  pending: Map<number, FillerCandidate>;
  segments: ReturnType<typeof createPolygonSegmentQuery>;
  seenSnaps: Map<Variant, Set<string>>;
  nextSnap: number;
  queuedSnaps: number[];
  gridContours: WeakMap<Polygon, boolean>;
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

function createRequiredAttempt(
  layoutIndex: number,
  piecesInLayout: number,
): RequiredLayoutAttemptDiagnostics {
  return {
    layoutIndex,
    piecesInLayout,
    variantsConsidered: 0,
    xCoordinatesProposed: 1,
    xCoordinatesUnique: 0,
    yCoordinatesProposed: 1,
    yCoordinatesUnique: 0,
    candidateOpportunitiesPotential: 0,
    candidateOpportunitiesEmitted: 0,
    candidateCacheLookups: 0,
    candidateCacheHits: 0,
    candidatesPrunedBeforeTranslation: 0,
    candidatesTranslated: 0,
    bucketLookups: 0,
    bucketReferences: 0,
    uniqueNeighbors: 0,
    broadPhaseChecks: 0,
    exactCollisionChecks: 0,
    contactChecks: 0,
    elapsedMs: 0,
    success: false,
  };
}

function findPlacementInLayout(
  variants: readonly Variant[],
  layout: MutableLayout,
  canvas: MultiNestingCanvas,
  step: number,
  diagnostics: NestingDiagnostics,
  accepts?: (placement: PolygonPlacement, variant: Variant) => boolean,
  preferContact: false | 'garment' | 'free-png' = false,
  fillerSearch?: FillerSearch,
  requiredAttempt?: RequiredLayoutAttemptDiagnostics,
  requiredEnumerationContext?: RequiredEnumerationContext,
  requiredSearchIdentity?: object,
): Omit<InternalPiece, 'pieceId'> | null {
  const clearance = canvas.minimumPieceClearance ?? 0;
  const extent = canvas.outlineExtentMm ?? 0;
  const profile = diagnostics.profile;
  if (!fillerSearch && requiredEnumerationContext) diagnostics.requiredSearchAttempts++;
  const enumerationState = !fillerSearch && requiredEnumerationContext && requiredSearchIdentity
    ? getRequiredEnumerationState(requiredEnumerationContext, layout, requiredSearchIdentity)
    : undefined;
  const priorEnumerationAttempts = enumerationState?.attempts ?? 0;
  const previousXCoordinates = enumerationState ? new Set(enumerationState.xCoordinates) : undefined;
  const previousYCoordinates = enumerationState ? new Set(enumerationState.yCoordinates) : undefined;
  const previousContactXCoordinates = enumerationState ? new Set(enumerationState.contactXCoordinates) : undefined;
  const previousContactYCoordinates = enumerationState ? new Set(enumerationState.contactYCoordinates) : undefined;
  if (enumerationState) {
    if (enumerationState.attempts > 0 && enumerationState.lastVersion !== layout.pieces.length) {
      diagnostics.requiredSearchRestartsFromBeginning++;
    }
    if (enumerationState.attempts === 0) diagnostics.requiredEnumerationStates++;
    enumerationState.attempts++;
    enumerationState.lastVersion = layout.pieces.length;
  }
  const coordinatesStart = startBlock(profile, 'candidateCoordinates');
  // Cross edge coordinates so a right edge and a top edge from different pieces
  // can define a cavity. Both floor and ceil retain grid alignments on either side.
  const xs = new Set<number>([extent]);
  const ys = new Set<number>([extent]);
  const gridXs = enumerationState ? new Set<number>([0]) : undefined;
  const gridYs = enumerationState ? new Set<number>([0]) : undefined;
  const contactXs = enumerationState ? new Set<number>() : undefined;
  const contactYs = enumerationState ? new Set<number>() : undefined;
  const lastPieceXs = enumerationState ? new Set<number>() : undefined;
  const lastPieceYs = enumerationState ? new Set<number>() : undefined;
  const add = (set: Set<number>, value: number, limit: number, pieceIndex?: number) => {
    const isX = set === xs;
    const gridCoordinates = isX ? gridXs : gridYs;
    const contactCoordinates = isX ? contactXs : contactYs;
    const lastPieceCoordinates = isX ? lastPieceXs : lastPieceYs;
    const insert = (coordinate: number, isGrid: boolean, isContact: boolean) => {
      if (enumerationState && set.has(coordinate)) {
        diagnostics.requiredDuplicateAxisCoordinateProposals++;
        diagnostics.requiredDuplicateAxisCoordinateProposalsSkipped++;
      }
      set.add(coordinate);
      if (isGrid) gridCoordinates?.add(coordinate);
      if (isContact) contactCoordinates?.add(coordinate);
      if (pieceIndex === layout.pieces.length - 1) lastPieceCoordinates?.add(coordinate);
    };
    if ((preferContact || clearance || extent) && value >= 0 && value <= limit) {
      if (requiredAttempt) {
        if (isX) requiredAttempt.xCoordinatesProposed++;
        else requiredAttempt.yCoordinatesProposed++;
      }
      insert(value, false, pieceIndex !== undefined);
    }
    for (const coordinate of [
      Math.floor(value / step) * step,
      Math.ceil(value / step) * step,
    ]) {
      if (coordinate >= 0 && coordinate <= limit) {
        if (requiredAttempt) {
          if (isX) requiredAttempt.xCoordinatesProposed++;
          else requiredAttempt.yCoordinatesProposed++;
        }
        insert(coordinate, true, false);
      }
    }
  };
  const searchTop = Math.ceil((layout.usedHeight + clearance + extent) / step) * step;
  for (const variant of variants) {
    if (extent && variant.cutComponents) {
      const cut = getPolygonBounds(variant.cutComponents.flat());
      add(xs, Math.max(0, extent-cut.minX), canvas.width);
      add(ys, Math.max(0, extent-cut.minY), canvas.height);
      add(xs, canvas.width-extent-cut.maxX, canvas.width);
    }
    add(xs, canvas.width - variant.bounds.width - extent, canvas.width);
    for (let pieceIndex = 0; pieceIndex < layout.pieces.length; pieceIndex++) {
      const { bounds } = layout.pieces[pieceIndex]!;
      if (clearance) {
        add(xs, bounds.minX - variant.bounds.width - clearance, canvas.width, pieceIndex);
        add(xs, bounds.maxX + clearance, canvas.width, pieceIndex);
        add(ys, bounds.minY - variant.bounds.height - clearance, searchTop, pieceIndex);
        add(ys, bounds.maxY + clearance, searchTop, pieceIndex);
      }
      for (const edge of [bounds.minX, bounds.maxX]) {
        add(xs, edge, canvas.width, pieceIndex);
        add(xs, edge - variant.bounds.width, canvas.width, pieceIndex);
      }
      for (const edge of [bounds.minY, bounds.maxY]) {
        add(ys, edge, searchTop, pieceIndex);
        add(ys, edge - variant.bounds.height, searchTop, pieceIndex);
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
  if (requiredAttempt) {
    requiredAttempt.xCoordinatesUnique = orderedX.length;
    requiredAttempt.yCoordinatesUnique = orderedY.length;
    requiredAttempt.variantsConsidered = variants.length;
    requiredAttempt.candidateOpportunitiesPotential =
      orderedX.length * orderedY.length * variants.length;
  }
  if (enumerationState) {
    for (const x of orderedX) enumerationState.xCoordinates.add(x);
    for (const y of orderedY) enumerationState.yCoordinates.add(y);
    for (const x of contactXs!) enumerationState.contactXCoordinates.add(x);
    for (const y of contactYs!) enumerationState.contactYCoordinates.add(y);
  }
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
let bestFillerOrdinal: number | undefined;
const improvesFiller = (score: number[]) => {
  const difference = bestScore ? score.findIndex((v,i)=>v!==bestScore![i]) : -1;
  return !bestScore || (difference >= 0 && score[difference]! < bestScore[difference]!);
};
const heightTolerance = 1e-9;
const improvesScore = (score: number[]) => {
  const difference = bestScore ? score.findIndex((value, index) =>
    index === 0 ? Math.abs(value - bestScore![index]!) > heightTolerance : value !== bestScore![index]) : -1;
  return !bestScore || (difference >= 0 && score[difference]! < bestScore[difference]!);
};
// Same geometric tolerance as canvas fitting/contact. Height pruning is local
// to this search, never a persistent rejection: later pieces can grow the layout.
const canImprove = (x: number, y: number, variant: Variant) =>
  x >= 0 && y >= 0 &&
  x + Math.max(variant.bounds.width, variant.fineBounds.width) <= canvas.width + heightTolerance &&
  y + Math.max(variant.bounds.height, variant.fineBounds.height) <= canvas.height + heightTolerance &&
  (!bestScore || Math.max(layout.usedHeight, y + variant.bounds.height) <= bestScore[0]! + heightTolerance) &&
  // Required PNG score compares x before contacts when heights tie. Keep every
  // lower-height candidate, and every equal-x candidate that could win on contact.
  // This is search-local pruning; never cache it as a geometric rejection.
  (preferContact !== 'free-png' || !bestScore ||
    Math.abs(Math.max(layout.usedHeight, y + variant.bounds.height) - bestScore[0]!) > heightTolerance ||
    x <= bestScore[1]!);
function* candidates() {
if (fillerSearch) {
  // Keep viable/deferred positions: contact can select beyond the old cursor.
  // Previously checked geometry only needs comparison with newly added pieces.
  function* emit(ordinal:number,state:FillerCandidate) {
    yield {...state, state, ordinal, key: undefined};
    if (state.rejected.has(`${state.x},${state.y}`)) fillerSearch!.pending.delete(ordinal);
  }
  function* drainSnaps() {
    for(const ordinal of fillerSearch!.queuedSnaps) {
      const state=fillerSearch!.pending.get(ordinal);
      if(state) yield* emit(ordinal,state);
    }
    fillerSearch!.queuedSnaps=[];
  }
  for (const [ordinal, state] of [...fillerSearch.pending]) {
    yield* emit(ordinal,state);
    yield* drainSnaps();
  }
  const rowSize = orderedX.length * variantStates.length;
  for (let ordinal=fillerSearch.cursor; ordinal<orderedY.length*rowSize; ordinal++) {
    const y=orderedY[Math.floor(ordinal/rowSize)]!;
    const x=orderedX[Math.floor((ordinal%rowSize)/variantStates.length)]!;
    const {variant,rejected}=variantStates[ordinal%variantStates.length]!;
    fillerSearch.cursor=ordinal+1;
    const state: FillerCandidate = {x,y,variant,rejected,checkedPieces:0,contacts:0,neighbors:[],snapSource:true,snappedPieces:0};
    fillerSearch.pending.set(ordinal,state);
    yield* emit(ordinal,state);
    yield* drainSnaps();
  }
  return;
}
for (const y of orderedY) {
  for (const x of orderedX) {
    let key: string | undefined;
    for (const { variant, rejected } of variantStates) {
      const candidateGenerationStart = enumerationState
        ? startBlock(profile, 'candidateGeneration')
        : -1;
      if (preferContact && !canImprove(x, y, variant)) {
        if (requiredAttempt) requiredAttempt.candidatesPrunedBeforeTranslation++;
        endBlock(profile, 'candidateGeneration', candidateGenerationStart);
        continue;
      }
      if (key === undefined) {
        const keyStart = startBlock(profile, 'candidateKey');
        key = `${x},${y}`;
        endBlock(profile, 'candidateKey', keyStart);
      }
      if (requiredAttempt) requiredAttempt.candidateOpportunitiesEmitted++;
      const candidate = { x, y, variant, rejected, state: undefined, ordinal: undefined, key };
      endBlock(profile, 'candidateGeneration', candidateGenerationStart);
      yield candidate;
    }
  }
}
// Exact edge coordinates above retain cheap contact snaps. Never enumerate
// vertex pairs: their number grows with contour resolution, not piece count.
}
for (const { x, y, variant, rejected, state, ordinal, key: candidateKey } of candidates()) {
    const snapNeighbors:InternalPiece[] | undefined=state?.snapSource ? [] : undefined;
    if(state && snapNeighbors) {
      const onGrid=(polygon:Polygon):boolean=>{
        const cached=fillerSearch!.gridContours.get(polygon);
        if(cached!==undefined) return cached;
        const aligned=polygon.every((p,i)=>{
          const q=polygon[(i+1)%polygon.length]!;
          return Number.isInteger(p.x/step)&&Number.isInteger(p.y/step)&&(p.x===q.x||p.y===q.y);
        });
        fillerSearch!.gridContours.set(polygon,aligned);
        return aligned;
      };
      const movingOnGrid=(variant.collisionComponents??[variant.finePolygon]).every(onGrid);
      for(let i=state.snappedPieces;i<layout.pieces.length;i++) {
        const p=layout.pieces[i]!;
        // Axis-aligned grid contours can only project to existing grid points.
        if(movingOnGrid&&(p.collisionComponents??[p.finePolygon]).every(onGrid)) continue;
        if(x <= p.fineBounds.maxX+step && x+variant.fineBounds.width >= p.fineBounds.minX-step &&
          y <= p.fineBounds.maxY+step && y+variant.fineBounds.height >= p.fineBounds.minY-step) snapNeighbors.push(p);
      }
      if(!snapNeighbors.length) state.snappedPieces=layout.pieces.length;
    }
    if (state) {
      for (let i=state.checkedPieces;i<layout.pieces.length;i++) {
        const neighbor=layout.pieces[i]!;
        if (x <= neighbor.bucketBounds.maxX + 1e-9 &&
          x + Math.max(variant.bounds.width,variant.fineBounds.width) >= neighbor.bucketBounds.minX - 1e-9 &&
          y <= neighbor.bucketBounds.maxY + 1e-9 &&
          y + Math.max(variant.bounds.height,variant.fineBounds.height) >= neighbor.bucketBounds.minY - 1e-9) state.neighbors.push(neighbor);
      }
      state.checkedPieces=layout.pieces.length;
    }
    const newNeighbors = state?.neighbors;
    // An upper bound on possible contacts discards losers before translation
    // or exact collision. Deferred states retain their unchecked neighbors.
    if (state && !snapNeighbors?.length && !improvesFiller([-(state.contacts + newNeighbors!.length),x,y])) continue;
    let key = candidateKey;
    if (key === undefined) {
      const keyStart = startBlock(profile, 'candidateKey');
      key = `${x},${y}`;
      endBlock(profile, 'candidateKey', keyStart);
    }
      let historicalCandidate = false;
      if (!fillerSearch && requiredEnumerationContext) diagnostics.requiredCandidateEnumerations++;
      if (enumerationState) {
        const enumerationKey = `${variant.rotation}|${key}`;
        historicalCandidate = enumerationState.emittedCandidates.has(enumerationKey);
        if (historicalCandidate) {
          diagnostics.requiredCandidateHistoricalReenumerations++;
          if (!enumerationState.emittedCandidates.get(enumerationKey)) {
            enumerationState.emittedCandidates.set(enumerationKey, true);
            diagnostics.requiredDistinctHistoricalCandidates++;
          }
        } else {
          enumerationState.emittedCandidates.set(enumerationKey, false);
          diagnostics.requiredCandidateFreshEnumerations++;
          diagnostics.requiredEnumerationUniqueCandidates++;
          diagnostics.requiredEnumerationMaxUniqueCandidatesPerSearchIdentityLayout = Math.max(
            diagnostics.requiredEnumerationMaxUniqueCandidatesPerSearchIdentityLayout,
            enumerationState.emittedCandidates.size,
          );
          const hasNewCoordinate = priorEnumerationAttempts > 0 &&
            (!previousXCoordinates!.has(x) || !previousYCoordinates!.has(y));
          if (priorEnumerationAttempts === 0) {
            diagnostics.requiredFirstSearchEnumerations++;
          } else if (hasNewCoordinate) {
            diagnostics.requiredCandidateNewCoordinateEnumerations++;
            const isGridCandidate = gridXs!.has(x) && gridYs!.has(y);
            const isContactCandidate = contactXs!.has(x) || contactYs!.has(y);
            if (isGridCandidate) diagnostics.requiredNewCoordinateGridCandidates++;
            if (isContactCandidate) diagnostics.requiredNewCoordinateContactCandidates++;
            if (isGridCandidate && isContactCandidate) diagnostics.requiredNewCoordinateGridAndContactCandidates++;
            if (!isGridCandidate && !isContactCandidate) diagnostics.requiredNewCoordinateOtherCandidates++;
            if (lastPieceXs!.has(x) || lastPieceYs!.has(y)) {
              diagnostics.requiredNewCoordinateCandidatesFromLastPiece++;
            }
            if (previousContactXCoordinates!.has(x) || previousContactYCoordinates!.has(y)) {
              diagnostics.requiredNewCoordinateCandidatesUsingExistingContacts++;
            }
          } else {
            diagnostics.requiredFreshEmissionsFromPreviouslyExistingCoordinates++;
          }
        }
        const isGridCandidate = gridXs!.has(x) && gridYs!.has(y);
        const isContactCandidate = contactXs!.has(x) || contactYs!.has(y);
        if (isGridCandidate) diagnostics.requiredGridCandidatesEnumerated++;
        if (isContactCandidate) diagnostics.requiredContactCandidatesEnumerated++;
        if (isGridCandidate && isContactCandidate) diagnostics.requiredGridAndContactCandidatesEnumerated++;
        if (!isGridCandidate && !isContactCandidate) diagnostics.requiredOtherCandidatesEnumerated++;
      }
      const cacheStart = startBlock(profile, 'rejectionCache');
      const cacheHit = rejected.has(key);
      endBlock(profile, 'rejectionCache', cacheStart);

      if (requiredAttempt) requiredAttempt.candidateCacheLookups++;

      if (profile) {
        profile.counters.rejectionCacheLookups++;

        if (cacheHit) {
          profile.counters.rejectionCacheHits++;
        }
      }

      if (cacheHit) {
        diagnostics.candidateCacheHits++;
        if (requiredAttempt) requiredAttempt.candidateCacheHits++;
        if (enumerationState) diagnostics.requiredFrontierEligibleHistoricalCandidates++;
        if (historicalCandidate) {
          diagnostics.requiredHistoricalCandidateCacheHits++;
        } else if (cacheHit && enumerationState) {
          diagnostics.requiredCacheHitsWithoutSameIdentityHistory++;
        }
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
          if (requiredAttempt) requiredAttempt.candidatesPrunedBeforeTranslation++;
          rejected.add(key);
          continue;
        }
        if (
          bounds.maxX > canvas.width + 1e-9 ||
          bounds.maxY > canvas.height + 1e-9
        ) {
          if (requiredAttempt) requiredAttempt.candidatesPrunedBeforeTranslation++;
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
if (requiredAttempt) requiredAttempt.candidatesTranslated++;

const fitStart = startBlock(profile, 'canvasFit');
const fits = polygonFitsInsideCanvas(polygon, canvas);
endBlock(profile, 'canvasFit', fitStart);

if (!fits) {
  rejected.add(key);
  continue;
}
        const neighborsStart = startBlock(profile, 'neighborLookup');
        const neighbors = new Set<InternalPiece>(newNeighbors);
        for (const cell of newNeighbors ? [] : cellKeys(bounds)) {
          if (profile) {
            profile.counters.cellKeys++;
            profile.counters.bucketLookups++;
          }
          if (requiredAttempt) requiredAttempt.bucketLookups++;
          for (const neighbor of layout.buckets.get(cell) ?? []) {
            if (profile) profile.counters.neighborCandidates++;
            if (requiredAttempt) requiredAttempt.bucketReferences++;
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
        if (requiredAttempt) requiredAttempt.uniqueNeighbors += neighbors.size;
        let collision = false;
        for (const neighbor of neighbors) {
          diagnostics.broadPhaseChecks++;
          if (requiredAttempt) requiredAttempt.broadPhaseChecks++;
          const broadStart = startBlock(profile, 'boundsOverlap');
          const overlaps = boundsOverlapWithArea(bounds, neighbor.bounds);
endBlock(profile, 'boundsOverlap', broadStart);

if (!overlaps) {
  continue;
}

diagnostics.exactPolygonCollisionChecks++;
          if (requiredAttempt) requiredAttempt.exactCollisionChecks++;
          const collisionStart = startBlock(profile, 'polygonsOverlap');
          const overlapsPolygon = !variant.collisionComponents && !neighbor.collisionComponents && (fillerSearch?.overlap ?? polygonsOverlap)(
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

  const finePolygonStart = startBlock(profile, 'fineCandidatePolygon');
const finePolygon = variant.finePolygon.map((point) => ({
  x: point.x + x,
  y: point.y + y,
}));
const collisionComponents = fillerSearch
  ? variant.collisionComponents?.map(p => p.map(point => ({x:point.x + x,y:point.y + y})))
  : undefined;
const translatedCandidateComponents: (Polygon | undefined)[] = variant.collisionComponents
  ? new Array(variant.collisionComponents.length)
  : [];
const translatedCandidateComponentBounds: (PolygonBounds | undefined)[] = variant.collisionComponentBounds
  ? new Array(variant.collisionComponentBounds.length)
  : [];
if (profile && variant.collisionComponents) diagnostics.polygonCollision.exactCollisionCandidateScratchArrays += 2;
endBlock(profile, 'fineCandidatePolygon', finePolygonStart);

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

  const cutComponents = variant.cutComponents?.map(p => p.map(v => ({x:v.x+x,y:v.y+y})));
  let cutBounds: PolygonBounds | undefined;
  if (clearance || extent) {
    const nominal = cutComponents ?? collisionComponents ?? (variant.collisionComponents
      ? variant.collisionComponents.map(p => p.map(v => ({x:v.x+x,y:v.y+y}))) : [finePolygon]);
    cutBounds = getPolygonBounds(nominal.flat());
    if (cutBounds.minX < extent - 1e-9 || cutBounds.minY < extent - 1e-9 ||
        cutBounds.maxX > canvas.width - extent + 1e-9 || cutBounds.maxY > canvas.height - extent + 1e-9) {
      rejected.add(key); continue;
    }
    let invalid = false;
    for (const neighbor of layout.pieces) {
      diagnostics.broadPhaseChecks++;
      const other = neighbor.cutComponents ?? neighbor.collisionComponents ?? [neighbor.finePolygon];
      const otherBounds = neighbor.cutBounds ?? neighbor.fineBounds;
      if (Math.hypot(Math.max(0, cutBounds.minX-otherBounds.maxX,otherBounds.minX-cutBounds.maxX),
        Math.max(0,cutBounds.minY-otherBounds.maxY,otherBounds.minY-cutBounds.maxY)) >= clearance) continue;
      diagnostics.exactPolygonCollisionChecks++;
      if (contoursViolateClearance(nominal, other, clearance)) {invalid=true;break;}
    }
    if (invalid) {rejected.add(key);continue;}
  }

  const fineNeighbors = new Set<InternalPiece>(newNeighbors);

  for (const cell of newNeighbors ? [] : cellKeys(fineBounds)) {
    for (const neighbor of layout.buckets.get(cell) ?? []) {
      fineNeighbors.add(neighbor);
    }
  }

  let fineCollision = false;
  let candidateEnteredComponentPath = false;

  for (const neighbor of fineNeighbors) {
    // Mixed PNG/component pairs skip the coarse polygon collision above.
    // Preflight uses components for PNGs and the fast polygon for other pieces;
    // a fine-contour contact must also be valid against that same geometry.
    if (fillerSearch && Boolean(collisionComponents) !== Boolean(neighbor.collisionComponents) &&
      boundsOverlapWithArea(bounds, neighbor.bounds) &&
      (collisionComponents ?? [polygon]).some(p =>
        (neighbor.collisionComponents ?? [neighbor.polygon]).some(q => fillerSearch.overlap(p,q)))) {
      fineCollision = true;
      break;
    }
    if (!boundsOverlapWithArea(fineBounds, neighbor.fineBounds)) {
      continue;
    }

    const usesComponentPath = Boolean(variant.collisionComponents || neighbor.collisionComponents);
    if (!fillerSearch && usesComponentPath && !candidateEnteredComponentPath) {
      diagnostics.candidatesEnteringComponentPath++;
      candidateEnteredComponentPath = true;
    }
    let overlapsFine: boolean;
    if (fillerSearch) {
      overlapsFine = (collisionComponents ?? [finePolygon]).some(p =>
        (neighbor.collisionComponents ?? [neighbor.finePolygon]).some(q => fillerSearch.overlap(p,q)));
    } else if (usesComponentPath) {
      const componentStart = startBlock(profile, 'componentOverlap');
      overlapsFine = componentsOverlapAtOffset(
        variant.collisionComponents ?? [finePolygon],
        variant.collisionComponentBounds ?? [fineBounds],
        Boolean(variant.collisionComponents),
        x,
        y,
        neighbor.collisionComponents ?? [neighbor.finePolygon],
        neighbor.collisionComponentBounds ?? [neighbor.fineBounds],
        translatedCandidateComponents,
        translatedCandidateComponentBounds,
        diagnostics,
        profile ? diagnostics.polygonCollision : undefined,
      );
      endBlock(profile, 'componentOverlap', componentStart);
    } else {
      overlapsFine = polygonsOverlap(finePolygon, neighbor.finePolygon, fineBounds, neighbor.fineBounds);
    }
    if (overlapsFine) {
      fineCollision = true;
      break;
    }
  }

  if (!fineCollision) {
    const placedCollisionComponents = collisionComponents ?? (variant.collisionComponents
      ? variant.collisionComponents.map((_, index) => translatedComponentAt(
          variant.collisionComponents!, index, x, y, translatedCandidateComponents, diagnostics,
          profile ? diagnostics.polygonCollision : undefined,
        ))
      : undefined);
    const placedCollisionComponentBounds = !fillerSearch && variant.collisionComponentBounds
      ? variant.collisionComponentBounds.map((_, index) => translatedComponentBoundsAt(
          variant.collisionComponentBounds!, index, x, y, translatedCandidateComponentBounds,
        ))
      : undefined;
    const candidate = {
      ...(cutBounds ? {cutBounds} : {}),
      ...(cutComponents ? {cutComponents} : {}),
      ...(placedCollisionComponents ? {collisionComponents:placedCollisionComponents} : {}),
      ...(placedCollisionComponentBounds ? {collisionComponentBounds:placedCollisionComponentBounds} : {}),
      polygon,
      bounds,
      finePolygon,
      fineBounds,
      bucketBounds: unionBounds(bounds, fineBounds),
      placement: { x, y, rotation: variant.rotation },
    };
    if (state) {
      if (snapNeighbors?.length) {
        let seen=fillerSearch!.seenSnaps.get(variant);
        if(!seen) {seen=new Set();fillerSearch!.seenSnaps.set(variant,seen);}
        for(const neighbor of snapNeighbors) for(const snap of localContourSnaps(
          variant.collisionComponents??[variant.finePolygon],x,y,
          neighbor.collisionComponents??[neighbor.finePolygon],step,fillerSearch!.segments)) {
          if(snap.x<0 || snap.y<0 || snap.x+Math.max(variant.bounds.width,variant.fineBounds.width)>canvas.width+1e-9 ||
            snap.y+Math.max(variant.bounds.height,variant.fineBounds.height)>canvas.height+1e-9 ||
            (xs.has(snap.x)&&ys.has(snap.y))) continue;
          const key=`${snap.x},${snap.y}`;
          if(seen.has(key)||rejected.has(key)) continue;
          seen.add(key);
          if(accepts && !accepts({x:snap.x,y:snap.y,rotation:variant.rotation},variant)) continue;
          const id=fillerSearch!.nextSnap--;
          fillerSearch!.pending.set(id,{...snap,variant,rejected,checkedPieces:0,contacts:0,neighbors:[],snapSource:false,snappedPieces:0});
          fillerSearch!.queuedSnaps.push(id);
        }
        state.snappedPieces=layout.pieces.length;
      }
      const parts = collisionComponents ?? [finePolygon];
      for (const neighbor of fineNeighbors) {
        if (parts.some(p => (neighbor.collisionComponents ?? [neighbor.finePolygon]).some(q => fillerSearch!.touch(p,q)))) state.contacts++;
      }
      state.checkedPieces = layout.pieces.length;
      state.neighbors=[];
      const score = [-state.contacts,x,y];
      if (improvesFiller(score)) {best=candidate;bestScore=score;bestFillerOrdinal=ordinal;}
      continue;
    }
    if (!preferContact) return candidate;
    const contactNeighbors = [...fineNeighbors].filter(neighbor =>
      fineBounds.minX <= neighbor.fineBounds.maxX + heightTolerance &&
      neighbor.fineBounds.minX <= fineBounds.maxX + heightTolerance &&
      fineBounds.minY <= neighbor.fineBounds.maxY + heightTolerance &&
      neighbor.fineBounds.minY <= fineBounds.maxY + heightTolerance);
    const potentialGarments = contactNeighbors.filter(n => n.kind === 'garment').length;
    const requiredScore = (garments: number, others: number) => preferContact === 'free-png'
      ? [Math.max(layout.usedHeight, bounds.maxY), x, -(garments + others), y]
      : [Math.max(layout.usedHeight, bounds.maxY), x, -garments, -others, y];
    // Position is prioritized after used height. Contact only breaks ties
// between equally compact candidates.
if (!improvesScore(requiredScore(potentialGarments, contactNeighbors.length - potentialGarments))) continue;
    let garments = 0;
    let others = 0;
    for (const neighbor of contactNeighbors) {
      const contactStart = startBlock(profile, 'contact');
      const touches = preferContact === 'free-png'
        ? (candidate.collisionComponents ?? [finePolygon]).some(p =>
          (neighbor.collisionComponents ?? [neighbor.finePolygon]).some(q => polygonsTouch(p,q)))
        : polygonsTouch(finePolygon, neighbor.finePolygon);
      endBlock(profile, 'contact', contactStart);
      if (requiredAttempt) requiredAttempt.contactChecks++;
      if (touches) {
        if (neighbor.kind === 'garment') garments++;
        else others++;
      }
    }
   const score = requiredScore(garments, others);
    if (improvesScore(score)) {
      best = candidate;
      bestScore = score;
    }
    continue;
  }
}

// Layouts only gain pieces: a collision cannot become valid later.
rejected.add(key);
  }
  if (bestFillerOrdinal !== undefined) fillerSearch!.pending.delete(bestFillerOrdinal);
  return best;
}

export function nestMultiplePieces(
  input: MultiNestingInput,
  reportProgress?: (progress: NestingProgress) => void,
): MultiNestingResult {
  const profile = input.diagnosticProfiling
    ? createNestingProfile()
    : undefined;
  const engineStart = profile ? performance.now() : 0;
  validateInput(input);
  reportProgress?.({ phase: 'preparing' });
  const diagnostics: NestingDiagnostics = {
  polygonCollision: createPolygonCollisionDiagnostics(),
  requiredMs: 0,
  fillerMs: 0,
  requiredFailedVersionHits: 0,
  candidatePlacementsTested: 0,
    polygonTransforms: 0,
    polygonTranslations: 0,
    broadPhaseChecks: 0,
    exactPolygonCollisionChecks: 0,
    layoutsCreated: 0,
    placedCount: 0,
    candidateCacheHits: 0,
    componentTranslations: 0,
    piecesUsingCollisionComponents: 0,
    candidatesEnteringComponentPath: 0,
    componentsOverlapCalls: 0,
    componentPairCandidates: 0,
    componentPairAabbRejects: 0,
    componentPairBoundsRecomputed: 0,
    componentBoundsPrecomputations: 0,
    componentPairExactChecks: 0,
    componentPairExactCollisions: 0,
    requiredSearchAttempts: 0,
    requiredCandidateEnumerations: 0,
    requiredCandidateFreshEnumerations: 0,
    requiredCandidateHistoricalReenumerations: 0,
    requiredDistinctHistoricalCandidates: 0,
    requiredFirstSearchEnumerations: 0,
    requiredFreshEmissionsFromPreviouslyExistingCoordinates: 0,
    requiredSearchRestartsFromBeginning: 0,
    requiredGridCandidatesEnumerated: 0,
    requiredContactCandidatesEnumerated: 0,
    requiredGridAndContactCandidatesEnumerated: 0,
    requiredOtherCandidatesEnumerated: 0,
    requiredDuplicateAxisCoordinateProposals: 0,
    requiredDuplicateAxisCoordinateProposalsSkipped: 0,
    requiredFrontierEligibleHistoricalCandidates: 0,
    requiredCacheHitsWithoutSameIdentityHistory: 0,
    requiredCandidateNewCoordinateEnumerations: 0,
    requiredNewCoordinateGridCandidates: 0,
    requiredNewCoordinateContactCandidates: 0,
    requiredNewCoordinateGridAndContactCandidates: 0,
    requiredNewCoordinateOtherCandidates: 0,
    requiredNewCoordinateCandidatesFromLastPiece: 0,
    requiredNewCoordinateCandidatesUsingExistingContacts: 0,
    requiredHistoricalCandidateCacheHits: 0,
    requiredEnumerationUniqueCandidates: 0,
    requiredEnumerationMaxUniqueCandidatesPerSearchIdentityLayout: 0,
    requiredEnumerationStates: 0,
  };
  const requiredEnumerationContext: RequiredEnumerationContext | undefined = input.diagnosticRequiredEnumeration
    ? new WeakMap()
    : undefined;
  if (profile) diagnostics.profile = profile;
  if (input.diagnosticRequiredScale) diagnostics.requiredPieces = [];
  const preparationStart = startBlock(profile, 'preparation');
  // Value keys also deduplicate separately allocated definitions / worker clones.
  // Local to this run: no stale geometry after edits and no cross-job retention.
  const geometry = new Map<
    string,
    {
      area: number;
      rotations: Map<PieceRotation, Variant>;
      requiredSearchIdentities: Map<string, object>;
    }
  >();
  const prepared = input.pieces
    .map((piece) => {
      if (piece.collisionComponents) diagnostics.piecesUsingCollisionComponents++;
      const sourcePolygon = piece.collisionComponents ? componentEnvelope(piece.collisionComponents) : piece.polygon;
      const fineSourcePolygon = piece.collisionComponents ? sourcePolygon : piece.finePolygon ?? piece.polygon;

const key = JSON.stringify([
  sourcePolygon.map((point) => [point.x, point.y]),
  fineSourcePolygon.map((point) => [point.x, point.y]),
  piece.collisionComponents, piece.cutComponents, piece.cutAnchor,
]);
      let cached = geometry.get(key);
      if (!cached) {
        const bounds = getPolygonBounds(sourcePolygon);
        cached = {
          area: bounds.width * bounds.height,
          rotations: new Map(),
          requiredSearchIdentities: new Map(),
        };
        geometry.set(key, cached);
      }
      const variants = piece.allowedRotations
        .map((rotation) => {
          let variant = cached.rotations.get(rotation);
          if (!variant) {
            const polygon = transformPolygon(sourcePolygon, {
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

            const collisionComponents = piece.collisionComponents
              ? transformComponents(piece.collisionComponents, {x:0,y:0,rotation})
              : undefined;
            const collisionComponentBounds = collisionComponents?.map(getPolygonBounds);
            diagnostics.componentBoundsPrecomputations += collisionComponentBounds?.length ?? 0;

            let cutComponents: readonly Polygon[] | undefined;
            if (piece.cutComponents) {
              const cutAnchor = piece.cutAnchor ?? fineSourcePolygon;
              const rotatedAnchor = getPolygonBounds(cutAnchor.map(v => rotatePoint(v, rotation)));
              cutComponents = piece.cutComponents.map(p => p.map(v => {
                const r = rotatePoint(v, rotation);
                return {x:r.x-rotatedAnchor.minX,y:r.y-rotatedAnchor.minY};
              }));
            }
            variant = {
              ...(cutComponents ? {cutComponents} : {}),
              ...(collisionComponents ? {collisionComponents} : {}),
              ...(collisionComponentBounds ? {collisionComponentBounds} : {}),
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
      const rotationKey = variants.map((variant) => variant.rotation).join(',');
      const requiredSearchMode = piece.kind ? 'contact-exact' : 'grid-only';
      const requiredSearchKey = `${requiredSearchMode}|${rotationKey}`;
      let requiredSearchIdentity = cached.requiredSearchIdentities.get(requiredSearchKey);
      if (!requiredSearchIdentity) {
        requiredSearchIdentity = {};
        cached.requiredSearchIdentities.set(requiredSearchKey, requiredSearchIdentity);
      }
      return { piece, variants, area: cached.area, requiredSearchIdentity };
    })
    .sort((a, b) => b.area - a.area);
  endBlock(profile, 'preparation', preparationStart);
  const layouts: MutableLayout[] = [];
const unplacedPieceIds: string[] = [];
const requiredStartedAt = input.diagnosticPhaseTiming
  ? performance.now()
  : 0;

for (const [pieceOffset, { piece, variants, requiredSearchIdentity }] of prepared.entries()) {
    const reportRequiredProgress = () => reportProgress?.({
      phase: 'required',
      completed: pieceOffset + 1,
      total: prepared.length,
    });
    const pieceDiagnostics: RequiredPieceDiagnostics | undefined = diagnostics.requiredPieces
      ? {
          pieceIndex: pieceOffset + 1,
          pieceId: piece.id,
          layoutsTried: 0,
          successfulPlacements: 0,
          elapsedMs: 0,
          attempts: [],
        } satisfies RequiredPieceDiagnostics
      : undefined;
    const pieceStartedAt = pieceDiagnostics ? performance.now() : 0;
    if (pieceDiagnostics) diagnostics.requiredPieces!.push(pieceDiagnostics);
    if (!variants.length) {
      unplacedPieceIds.push(piece.id);
      if (pieceDiagnostics) pieceDiagnostics.elapsedMs = performance.now() - pieceStartedAt;
      reportRequiredProgress();
      continue;
    }
    let placed = false;
    for (const [layoutIndex, layout] of layouts.entries()) {
      if (layout.failedRequiredVersions.get(requiredSearchIdentity) === layout.pieces.length) {
        diagnostics.requiredFailedVersionHits++;
        continue;
      }
      const attempt = pieceDiagnostics
        ? createRequiredAttempt(layoutIndex, layout.pieces.length)
        : undefined;
      const attemptStartedAt = attempt ? performance.now() : 0;
      const result = findPlacementInLayout(
        variants,
        layout,
        input.canvas,
        input.scanStepMm ?? 10,
        diagnostics,
        undefined,
        layout.pieces.length > 0 ? piece.kind ?? false : false,
        undefined,
        attempt,
        requiredEnumerationContext,
        requiredSearchIdentity,
      );
      if (attempt && pieceDiagnostics) {
        attempt.elapsedMs = performance.now() - attemptStartedAt;
        attempt.success = Boolean(result);
        pieceDiagnostics.layoutsTried++;
        pieceDiagnostics.attempts.push(attempt);
      }
      if (result) {
        addPiece(layout, { ...result, pieceId: piece.id, ...(piece.kind ? { kind: piece.kind } : {}) });
        placed = true;
        if (pieceDiagnostics) pieceDiagnostics.successfulPlacements++;
        break;
      }
      layout.failedRequiredVersions.set(requiredSearchIdentity, layout.pieces.length);
    }
    if (!placed) {
      const layout: MutableLayout = {
        pieces: [],
        buckets: new Map(),
        rejected: new Map(),
        failedRequiredVersions: new Map(),
        usedWidth: 0,
        usedHeight: 0,
      };
      const attempt = pieceDiagnostics
        ? createRequiredAttempt(layouts.length, 0)
        : undefined;
      const attemptStartedAt = attempt ? performance.now() : 0;
      const result = findPlacementInLayout(
        variants,
        layout,
        input.canvas,
        input.scanStepMm ?? 10,
        diagnostics,
        undefined,
        false,
        undefined,
        attempt,
        requiredEnumerationContext,
        requiredSearchIdentity,
      );
      if (attempt && pieceDiagnostics) {
        attempt.elapsedMs = performance.now() - attemptStartedAt;
        attempt.success = Boolean(result);
        pieceDiagnostics.layoutsTried++;
        pieceDiagnostics.attempts.push(attempt);
      }
      if (!result) {
        unplacedPieceIds.push(piece.id);
        if (pieceDiagnostics) pieceDiagnostics.elapsedMs = performance.now() - pieceStartedAt;
        reportRequiredProgress();
        continue;
      }
      addPiece(layout, { ...result, pieceId: piece.id, ...(piece.kind ? { kind: piece.kind } : {}) });
      layouts.push(layout);
      diagnostics.layoutsCreated++;
      if (pieceDiagnostics) pieceDiagnostics.successfulPlacements++;
    }
    diagnostics.placedCount++;
    if (pieceDiagnostics) pieceDiagnostics.elapsedMs = performance.now() - pieceStartedAt;
    reportRequiredProgress();
  }
  diagnostics.requiredMs =
  requiredStartedAt > 0 ? performance.now() - requiredStartedAt : 0;

// Phase 2 starts only after phase 1 is complete. It never enters the new-layout path.
const requiredHeights = layouts.map(layout => layout.usedHeight);
let extraCount = 0;

const fillerStartedAt =
  input.diagnosticPhaseTiming &&
  input.fillers?.length &&
  unplacedPieceIds.length === 0
    ? performance.now()
    : 0;
  if (input.fillers?.length && unplacedPieceIds.length === 0) {
    const fillerSegments = createPolygonSegmentQuery();
    const fillerOverlap = createIndexedPolygonOverlap(fillerSegments);
    const fillerTouch = createIndexedPolygonTouch(fillerSegments);
    const sourceById = new Map(prepared.map(entry => [entry.piece.id, entry]));
    const identities = new Set(input.pieces.map(piece => piece.id));
    const requestedDefinitions = new Set<string>();
    const materialBounds = layouts.map(layout => {
      let full: PolygonBounds | undefined;
      for (const placed of layout.pieces) {
        const source = sourceById.get(placed.pieceId)!.piece;
        const bounds = source.artworkSize
          ? artworkBounds(source.collisionComponents ? componentEnvelope(source.collisionComponents) : source.polygon, placed.placement, source.artworkSize)
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
        ? [[variant.rotation, prepareArtworkBounds(source.piece.collisionComponents ? componentEnvelope(source.piece.collisionComponents) : source.piece.polygon, variant.rotation, source.piece.artworkSize)] as const]
        : []));
      const fullArtworkAt = (placement: PolygonPlacement): PolygonBounds | undefined => {
        const bounds = artworkVariants.get(placement.rotation);
        return bounds ? placeArtworkBounds(bounds, placement) : undefined;
      };
      return { filler, variants, fullArtworkAt, copyIndex: 0,
        searches: new Map<number, FillerSearch>(),
        failedVersions: new Map<number, number>() };
    });

    for (const layout of layouts) layout.rejected.clear();
    let completedFillerSources = 0;
    const reportFillerProgress = () => reportProgress?.({
      phase: 'fillers',
      completed: ++completedFillerSources,
      total: activeFillers.length,
    });
    const tryPlaceOne = (item: (typeof activeFillers)[number]): boolean => {
      const { filler, variants, fullArtworkAt } = item;
      const copyIndex = item.copyIndex;
      for (const [layoutIndex, layout] of layouts.entries()) {
        if (item.failedVersions.get(layoutIndex) === layout.pieces.length) continue;
        let search = item.searches.get(layoutIndex);
        if (!search) {search = {cursor:0,overlap:fillerOverlap,touch:fillerTouch,pending:new Map(),segments:fillerSegments,
          seenSnaps:new Map(),nextSnap:-1,queuedSnaps:[],gridContours:new WeakMap()};item.searches.set(layoutIndex,search);}
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
          { ...input.canvas, height },
          input.scanStepMm ?? 10,
          diagnostics,
          accepts,
          false,
          search,
        );
        if (!placement) {item.failedVersions.set(layoutIndex,layout.pieces.length);continue;}

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
      reportFillerProgress();
    }

    let remaining = activeFillers.filter((candidate) => candidate.filler.mode === 'normal');
    while (remaining.length > 0) {
      let progress = false;
      const nextRemaining = [] as typeof remaining;
      for (const item of remaining) {
        if (tryPlaceOne(item)) {
          progress = true;
          nextRemaining.push(item);
        } else {
          reportFillerProgress();
        }
      }
      if (!progress) break;
      remaining = nextRemaining;
    }
  }
  diagnostics.fillerMs =
  fillerStartedAt > 0 ? performance.now() - fillerStartedAt : 0;
  reportProgress?.({ phase: 'finalizing' });
  const result: MultiNestingResult = {
    ...(input.fillers?.length ? { extraCount } : {}),
    layouts: layouts.map((layout, index) => ({
      ...(input.fillers?.length ? { requiredUsedHeight: requiredHeights[index]! } : {}),
      index,
      usedWidth: layout.usedWidth,
      usedHeight: layout.usedHeight,
      pieces: layout.pieces.map(({ pieceId, placement, polygon, extra, collisionComponents, cutComponents }) => ({
        ...(collisionComponents ? {collisionComponents} : {}),
        ...(cutComponents ? {cutComponents} : {}),
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
