import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PROFILE_BLOCKS,
  type NestingProfile,
  type ProfileBlock,
} from '../geometry/nesting-profiler';
import {
  DEFAULT_IMPRENTA_PROFILE,
  CANVAS_PROFILES,
  nestingCanvasForProfile,
  type CanvasProfileKind,
} from '../domain/canvas-profile';
import {
  nestInWorker,
  type NestingWorkerTiming,
} from '../geometry/nesting-client';
import {
  preflightBatch,
  type PreparedBatch,
  type FabricBatchResult,
} from '../export/export-plan';
import { MAX_SOURCE_PIXELS } from '../export/png-export';
import type { PngExportDiagnostics } from '../export/native-png-export';
import { BatchExportPanel } from './batch-export-panel';
import { exportPdfPrototype } from '../export/pdf-prototype';
import {
  expandPieceDefinitions,
  type PieceInstance,
} from '../domain/piece-instance';
import { groupPiecesByFabric } from '../domain/fabric-grouping';
import { getPieceSideLabel, PIECE_SIDES } from '../domain/piece-side';
import { getAllowedRotationsForPiece } from '../domain/piece-rotation';
import { DEFAULT_PRODUCTION_FABRIC } from '../domain/fabric';
import { batchPieceLimitError } from '../domain/batch-piece-limit';
import { parseOrderText, quantitiesFromOrder } from '../domain/order-import';
import {
  toggleFill,
  fillersForInstances,
  extraCounts,
  pngPieceSummaries,
} from '../domain/fill-gaps';
import type { BatchPieceDefinition } from '../domain/production-batch';
import { GARMENT_SIZES, type GarmentSize } from '../domain/size';
import { mm } from '../domain/units';
import { physicalSizeFromSourcePixels } from '../domain/source-image-size';
import {
  extractLargestAlphaPolygon,
  extractAlphaComponents,
  extractAlphaPixelBounds,
  type AlphaPixelBounds,
} from '../geometry/alpha-polygon';
import { componentEnvelope } from '../geometry/polygon-components';
import {
  type MultiNestingPiece,
  type NestingProgress,
} from '../geometry/multi-piece-nesting-engine';
import {
  getPolygonBounds,
  polygonPixelsToMillimeters,
} from '../geometry/polygon-transform';
import type { Polygon } from '../geometry/polygon';
import type {
  BatchPieceDraft,
  FreePngDraft,
  ProductionPieceDraft,
  ReplacementPieceDraft,
} from './batch-state';
import { FreePngPanel } from './free-png-panel';
import { chooseFreePng, validFreePngQuantity } from './free-png-import';
import type { SizeTemplateDraft } from './size-template-state';
import {
  findCollectionAsset,
  findCollectionReplacementAssets,
  findCollectionPreviewAsset,
  isCollectionComplete,
  type DesignCollection,
} from './design-collection-state';
import { AssetPreview } from './design-collection-library';
import {
  buildContourCacheKey,
  loadCachedContourPair,
  saveCachedContourPair,
} from '../persistence/contour-cache';
import {
  recordOptimizedBatch,
  type HistoricalSizeSummary,
} from '../persistence/historical-jobs';

import { buildHistoricalBatchPreviewFiles } from './historical-preview-builder';
import { summarizeProductionPlacement } from './production-summary';

const DEFAULT_ALPHA_THRESHOLD = 16;
const FAST_SIMPLIFICATION_PX = 3;
const FINE_SIMPLIFICATION_PX = 1.5;
const DEFAULT_SCAN_STEP_MM = 22.5;
export function getBatchPieceLimitError(
  pieces: readonly Pick<ProductionPieceDraft, 'kind' | 'quantity'>[],
): string | null {
  return batchPieceLimitError(pieces.reduce((count, piece) => count + piece.quantity, 0));
}

function formatMeters(millimeters: number): string {
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(millimeters / 1000);
}

function buildHistoricalSizeSummary(
  definitions: readonly BatchPieceDefinition[],
): HistoricalSizeSummary[] {
  const byModel = new Map<
    string,
    Map<
      GarmentSize,
      {
        front: number;
        back: number;
      }
    >
  >();

  for (const definition of definitions) {
    if (definition.kind !== 'garment') continue;
    const modelKey = `${definition.model}\u0000${definition.fabric}`;
    let bySize = byModel.get(modelKey);

    if (!bySize) {
      bySize = new Map();

      byModel.set(modelKey, bySize);
    }

    const current = bySize.get(definition.size) ?? {
      front: 0,
      back: 0,
    };

    if (definition.side === 'front') {
      current.front += definition.quantity;
    } else {
      current.back += definition.quantity;
    }

    bySize.set(definition.size, current);
  }

  return [...byModel.entries()]
    .sort(([left], [right]) =>
      left.localeCompare(right, 'es', {
        sensitivity: 'base',
      }),
    )
    .map(([modelKey, bySize]) => {
      const [rawModel, rawFabric] = modelKey.split('\u0000');
      const model = rawModel ?? modelKey;
      const fabric = rawFabric ?? '';
      return {
        model,
        fabric,

        sizes: GARMENT_SIZES.map((size) => {
          const quantities = bySize.get(size);

          if (!quantities) {
            return null;
          }

          /*
           * Una prenda tiene frente + espalda.
           * Sumamos cada lado por separado y
           * tomamos el mayor, evitando contar
           * dos veces la misma prenda.
           */
          const quantity = Math.max(quantities.front, quantities.back);

          return quantity > 0
            ? {
                size,
                quantity,
              }
            : null;
        }).filter(
          (
            item,
          ): item is {
            size: GarmentSize;
            quantity: number;
          } => item !== null,
        ),
      };
    })
    .filter((entry) => entry.sizes.length > 0);
}

type CollectionQuantities = Record<
  string,
  Partial<Record<GarmentSize, number>>
>;

const BATCH_SESSION_QUANTITIES_KEY = 'nestra.batch.collection-quantities';

function readSessionCollectionQuantities(): CollectionQuantities {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.sessionStorage.getItem(BATCH_SESSION_QUANTITIES_KEY);

    if (!raw) {
      return {};
    }

    const parsed: unknown = JSON.parse(raw);

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    const restored: CollectionQuantities = {};

    for (const [collectionId, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        continue;
      }

      const quantities: Partial<Record<GarmentSize, number>> = {};

      for (const size of GARMENT_SIZES) {
        const quantity = (value as Record<string, unknown>)[size];

        if (
          typeof quantity === 'number' &&
          Number.isSafeInteger(quantity) &&
          quantity >= 0
        ) {
          quantities[size] = quantity;
        }
      }

      if (Object.keys(quantities).length > 0) {
        restored[collectionId] = quantities;
      }
    }

    return restored;
  } catch {
    return {};
  }
}

const PROFILE_LABELS: Record<ProfileBlock, string> = {
  preparation: 'Preparación geometrías / variantes / orden',
  candidateCoordinates: 'Construcción y orden X/Y',
  rejectionCache: 'Lookup rejection cache',
  candidateBounds: 'Construcción bounds',
  candidatePolygon: 'Traducción polígono',
  canvasFit: 'polygonFitsInsideCanvas',
  neighborLookup: 'Cell keys / buckets / deduplicación',
  boundsOverlap: 'boundsOverlapWithArea',
  polygonsOverlap: 'polygonsOverlap total',
};
const COUNTER_LABELS: Record<keyof NestingProfile['counters'], string> = {
  coordinateSets: 'Sets X/Y construidos',
  xCoordinates: 'Coordenadas X únicas acumuladas',
  yCoordinates: 'Coordenadas Y únicas acumuladas',
  rejectionCacheLookups: 'Rejection cache lookups',
  rejectionCacheHits: 'Rejection cache hits',
  cellKeys: 'Cell keys de búsqueda',
  bucketLookups: 'Bucket lookups',
  neighborCandidates: 'Referencias de vecinos',
  neighborDuplicates: 'Duplicados eliminados',
  uniqueNeighbors: 'Vecinos únicos acumulados',
  segmentPairs: 'Pares de segmentos',
  segmentAabbRejected: 'Pares descartados por AABB',
  exactSegmentTests: 'Tests exactos de segmentos',
  collinearTests: 'Tests collinear overlap',
  pointInPolygonCalls: 'Llamadas point-in-polygon',
};

function createEmptyDraft(): BatchPieceDraft {
  return {
    kind: 'garment',
    id: crypto.randomUUID(),
    model: '',
    size: 'T8',
    side: 'front',
    fabric: DEFAULT_PRODUCTION_FABRIC,
    quantity: 1,
  };
}

interface PolygonPair {
  readonly cutComponents?: readonly Polygon[];
  readonly collisionComponents?: readonly Polygon[];
  readonly fastPolygon: Polygon;
  readonly finePolygon: Polygon;
  readonly sourceAlphaBounds: AlphaPixelBounds;
  readonly sourcePlacementBounds: AlphaPixelBounds;
}

function contourPixelBounds(polygon: Polygon): AlphaPixelBounds {
  const bounds = getPolygonBounds(polygon);
  const result = {
    x: bounds.minX,
    y: bounds.minY,
    width: bounds.width,
    height: bounds.height,
  };

  if (
    !Number.isInteger(result.x) ||
    !Number.isInteger(result.y) ||
    !Number.isInteger(result.width) ||
    !Number.isInteger(result.height) ||
    result.width <= 0 ||
    result.height <= 0
  ) {
    throw new Error('Bounds crudos de contorno inválidos.');
  }

  return result;
}

async function polygonsFromDefinition(
  definition: BatchPieceDefinition,
  file: File,
  includeCutContours = false,
): Promise<PolygonPair> {
  let cacheKey: string | undefined;

  try {
    if (definition.kind !== 'free-png')
      cacheKey = await buildContourCacheKey(file, {
        alphaThreshold: definition.alphaThreshold,
        fastSimplificationPx: FAST_SIMPLIFICATION_PX,
        fineSimplificationPx: FINE_SIMPLIFICATION_PX,
        physicalWidthMm: definition.physicalWidthMm,
        physicalHeightMm: definition.physicalHeightMm,
        ...(definition.kind === 'replacement-piece' ? { geometryMode: 'all-visible-replacement' as const } : {}),
      });

    const cached = cacheKey ? await loadCachedContourPair(cacheKey) : undefined;

    if (cached && !includeCutContours) {
      return cached;
    }
  } catch {
    /*
     * El caché es una optimización, no una dependencia.
     * Si IndexedDB o SHA-256 fallan, calculamos normalmente.
     */
    cacheKey = undefined;
  }

  const image = await createImageBitmap(file);
  const sourceCanvas = document.createElement('canvas');

  try {
    sourceCanvas.width = image.width;
    sourceCanvas.height = image.height;

    const context = sourceCanvas.getContext('2d');

    if (!context) {
      throw new Error(`No se pudo procesar ${definition.fileName}.`);
    }

    context.drawImage(image, 0, 0);

    const imageData = context.getImageData(
      0,
      0,
      sourceCanvas.width,
      sourceCanvas.height,
    );
    const sourceAlphaBounds = extractAlphaPixelBounds(
      imageData,
      definition.alphaThreshold,
    );

    if (!sourceAlphaBounds) {
      throw new Error(
        `No se pudo detectar contenido visible en ${definition.fileName}.`,
      );
    }

    if (definition.kind === 'free-png') {
      // Legacy cached pairs retain only the largest island. PNG collision uses
      // every exterior alpha contour, with only exact collinear reduction.
      const collisionComponents = extractAlphaComponents(
        imageData,
        definition.alphaThreshold,
      ).map((p) =>
        polygonPixelsToMillimeters(
          p,
          image.width,
          image.height,
          definition.physicalWidthMm,
          definition.physicalHeightMm,
        ),
      );
      if (!collisionComponents.length)
        throw new Error(
          `No se pudo detectar la silueta de ${definition.fileName}.`,
        );
      const envelope = componentEnvelope(collisionComponents);
      return {
        fastPolygon: envelope,
        finePolygon: envelope,
        collisionComponents,
        ...(includeCutContours ? {cutComponents: collisionComponents} : {}),
        sourceAlphaBounds,
        sourcePlacementBounds: sourceAlphaBounds,
      };
    }

    const fastContour = extractLargestAlphaPolygon(
      imageData,
      definition.alphaThreshold,
      FAST_SIMPLIFICATION_PX,
    );

    const fineContour = extractLargestAlphaPolygon(
      imageData,
      definition.alphaThreshold,
      FINE_SIMPLIFICATION_PX,
    );

    if (!fastContour || !fineContour) {
      throw new Error(
        `No se pudo detectar la silueta de ${definition.fileName}.`,
      );
    }

    // Separate letters can be outside the largest island. Reserve all visible
    // content with one conservative polygon, retaining the garment engine path.
    const replacementEnvelope = definition.kind === 'replacement-piece' && fineContour.outerLoopCount > 1
      ? [
          { x: sourceAlphaBounds.x, y: sourceAlphaBounds.y },
          { x: sourceAlphaBounds.x + sourceAlphaBounds.width, y: sourceAlphaBounds.y },
          { x: sourceAlphaBounds.x + sourceAlphaBounds.width, y: sourceAlphaBounds.y + sourceAlphaBounds.height },
          { x: sourceAlphaBounds.x, y: sourceAlphaBounds.y + sourceAlphaBounds.height },
        ]
      : undefined;
    const fastPolygon = polygonPixelsToMillimeters(
      replacementEnvelope ?? fastContour.simplifiedPolygon,
      image.width,
      image.height,
      definition.physicalWidthMm,
      definition.physicalHeightMm,
    );

    const finePolygon = polygonPixelsToMillimeters(
      replacementEnvelope ?? fineContour.simplifiedPolygon,
      image.width,
      image.height,
      definition.physicalWidthMm,
      definition.physicalHeightMm,
    );
    const sourcePlacementBounds = replacementEnvelope ? sourceAlphaBounds : contourPixelBounds(fineContour.rawPolygon);

    const cutComponents = includeCutContours ? extractAlphaComponents(imageData, definition.alphaThreshold).map(p =>
      polygonPixelsToMillimeters(p,image.width,image.height,definition.physicalWidthMm,definition.physicalHeightMm)) : undefined;
    const result: PolygonPair = {
      ...(cutComponents ? {cutComponents} : {}),
      fastPolygon,
      finePolygon,
      sourceAlphaBounds,
      sourcePlacementBounds,
    };

    if (cacheKey) {
      try {
        await saveCachedContourPair(cacheKey, result);
      } catch {
        /*
         * Un fallo escribiendo caché nunca debe impedir producir.
         */
      }
    }

    return result;
  } finally {
    sourceCanvas.width = 0;
    sourceCanvas.height = 0;
    image.close();
  }
}

function findTemplateForDraft(
  draft: BatchPieceDraft | ReplacementPieceDraft,
  templates: readonly SizeTemplateDraft[],
): SizeTemplateDraft | undefined {
  return templates.find(
    (template) => template.size === draft.size && template.side === draft.side,
  );
}

function validateDraft(draft: ProductionPieceDraft): string | null {
  if (draft.kind !== 'free-png' && draft.model.trim().length === 0) {
    return 'Todas las filas deben tener un modelo.';
  }

  if (draft.fabric.trim().length === 0) {
    return 'Todas las filas deben tener un tipo de tela.';
  }

  if (!Number.isSafeInteger(draft.quantity) || draft.quantity <= 0) {
    return 'Todas las cantidades deben ser enteros mayores que cero.';
  }

  if (
    !draft.file ||
    !draft.imageUrl ||
    !draft.sourceWidthPx ||
    !draft.sourceHeightPx
  ) {
    if (draft.kind === 'free-png') return 'Falta cargar el PNG libre.';
    return `Falta cargar el PNG de ${draft.model} ${draft.size} ${getPieceSideLabel(
      draft.side,
    )}.`;
  }

  return null;
}

interface OptimizationDiagnostics {
  readonly profileName: string;
  readonly profileWidthMm: number;
  readonly profileHeightMm: number;
  readonly engineProfiles: readonly {
    fabric: string;
    profile: NestingProfile;
  }[];
  readonly collectionPreparationMs: number;
  readonly definitionBuildMs: number;
  readonly contourExtractionMs: number;
  readonly groupingMs: number;

  readonly nestingRoundTripMs: number;
  readonly nestingWorkerMs: number;
  readonly nestingOverheadMs: number;
  readonly requiredMs: number;
  readonly fillerMs: number;

  readonly totalBeforePreflightMs: number;

  readonly definitions: number;
  readonly expandedPieces: number;
  readonly fabricGroups: number;

  readonly candidatePlacementsTested: number;
  readonly polygonTransforms: number;
  readonly polygonTranslations: number;
  readonly broadPhaseChecks: number;
  readonly exactPolygonCollisionChecks: number;
  readonly layoutsCreated: number;
  readonly candidateCacheHits: number;
}

type ReplacementFeedback = {
  readonly kind: 'success' | 'error';
  readonly message: string;
};

export type BatchOptimizationStatus =
  | 'idle'
  | 'running'
  | 'completed'
  | 'cancelled'
  | 'error';

export interface BatchOptimizationSummary {
  readonly status: BatchOptimizationStatus;
  readonly progress: number;
  readonly phase: string;
  readonly resultAvailable: boolean;
  readonly error?: string;
}

const IDLE_OPTIMIZATION: BatchOptimizationSummary = {
  status: 'idle',
  progress: 0,
  phase: 'Preparando',
  resultAvailable: false,
};

export type BatchExportStatus =
  | 'idle'
  | 'running'
  | 'completed'
  | 'cancelled'
  | 'error';

export interface BatchExportSummary {
  readonly status: BatchExportStatus;
  readonly phase: string;
  readonly error?: string;
}

const IDLE_EXPORT: BatchExportSummary = {
  status: 'idle',
  phase: 'Preparando exportación',
};

interface BatchPageProps {
  readonly templates: readonly SizeTemplateDraft[];
  readonly collections: readonly DesignCollection[];
  readonly onOptimizationChange?: (state: BatchOptimizationSummary) => void;
  readonly onExportChange?: (state: BatchExportSummary) => void;
}

export function BatchPage({
  templates,
  collections,
  onOptimizationChange,
  onExportChange,
}: BatchPageProps) {
  const garmentCollections = useMemo(() => collections.filter(isCollectionComplete), [collections]);
  const [pieces, setPieces] = useState<BatchPieceDraft[]>([createEmptyDraft()]);
  const [batchFabric, setBatchFabric] = useState('');
  const [orderImportOpen, setOrderImportOpen] = useState(false);
  const [orderText, setOrderText] = useState('');
  const [orderShowPreview, setOrderShowPreview] = useState(false);
  const [freePngs, setFreePngs] = useState<FreePngDraft[]>([]);
  const [replacementPieces, setReplacementPieces] = useState<ReplacementPieceDraft[]>([]);
  const [replacementCollectionId, setReplacementCollectionId] = useState(collections[0]?.id ?? '');
  const [replacementSize, setReplacementSize] = useState<GarmentSize>('T8');
  const [replacementSide, setReplacementSide] = useState<(typeof PIECE_SIDES)[number]>('front');
  const [replacementAssetPath, setReplacementAssetPath] = useState('');
  const [replacementQuantity, setReplacementQuantity] = useState(1);
  const [replacementFabric, setReplacementFabric] = useState('set');
  const [replacementFeedback, setReplacementFeedback] = useState<ReplacementFeedback | null>(null);
  const [isAddingReplacement, setIsAddingReplacement] = useState(false);
  const addingReplacementRef = useRef(false);
  useEffect(() => {
    const selectedCollection = collections.find(collection => collection.id === replacementCollectionId) ?? collections[0];
    if (!selectedCollection) {
      if (replacementCollectionId) setReplacementCollectionId('');
      return;
    }
    if (selectedCollection.id !== replacementCollectionId) setReplacementCollectionId(selectedCollection.id);
    const size = PIECE_SIDES.some(side => findCollectionReplacementAssets(selectedCollection, replacementSize, side).length)
      ? replacementSize
      : GARMENT_SIZES.find(candidate => PIECE_SIDES.some(side => findCollectionReplacementAssets(selectedCollection, candidate, side).length));
    if (size && size !== replacementSize) setReplacementSize(size);
    const side = size && findCollectionReplacementAssets(selectedCollection, size, replacementSide).length
      ? replacementSide
      : size && PIECE_SIDES.find(candidate => findCollectionReplacementAssets(selectedCollection, size, candidate).length);
    if (side && side !== replacementSide) setReplacementSide(side);
    const assets = size && side ? findCollectionReplacementAssets(selectedCollection, size, side) : [];
    if (!assets.some(asset => asset.relativePath === replacementAssetPath)) {
      setReplacementAssetPath(assets[0]?.relativePath ?? '');
    }
  }, [collections, replacementCollectionId, replacementSize, replacementSide, replacementAssetPath]);
  const replacementCollection = collections.find(collection => collection.id === replacementCollectionId);
  const replacementAssetOptions = replacementCollection
    ? findCollectionReplacementAssets(replacementCollection, replacementSize, replacementSide)
    : [];
  const fillActivationCounter = useRef(0);
  const [isImportingPng, setIsImportingPng] = useState(false);
  const mounted = useRef(true);

  const [collectionQuantities, setCollectionQuantities] =
    useState<CollectionQuantities>(readSessionCollectionQuantities);
  useEffect(() => {
    try {
      window.sessionStorage.setItem(
        BATCH_SESSION_QUANTITIES_KEY,
        JSON.stringify(collectionQuantities),
      );
    } catch {
      // El batch puede seguir funcionando aunque el almacenamiento
      // temporal de la sesión no esté disponible.
    }
  }, [collectionQuantities]);

  const [results, setResults] = useState<FabricBatchResult[]>([]);
  const [prepared, setPrepared] = useState<PreparedBatch | null>(null);
  const [usedTemplates, setUsedTemplates] = useState<
    readonly SizeTemplateDraft[] | null
  >(null);
  const [mode, setMode] = useState<CanvasProfileKind>('imprenta');
  const [isExporting, setIsExporting] = useState(false);
  const [exportSucceeded, setExportSucceeded] = useState(false);
  const [exportActivity, setExportActivity] =
    useState<BatchExportSummary>(IDLE_EXPORT);
  const [isResultStale, setIsResultStale] = useState(false);
  const [resetQuantitiesPending, setResetQuantitiesPending] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const exportSuccessTimer = useRef<number | null>(null);
  const optimizationRunIdRef = useRef<string | null>(null);
  const ownedUrls = useRef(new Set<string>());
  const fileVersions = useRef(new Map<string, number>());
  const preflightElapsedMs = useRef(0);

  const [optimizationDiagnostics, setOptimizationDiagnostics] =
    useState<OptimizationDiagnostics | null>(null);

  const [exportDiagnostics, setExportDiagnostics] =
    useState<PngExportDiagnostics | null>(null);
  const report = useMemo(() => {
    const startedAt = performance.now();

    const nextReport = prepared
      ? usedTemplates === templates
        ? preflightBatch(prepared)
          : {
            errors: ['Cambió la calibración. Volvé a optimizar el batch.'],
            warnings: [],
            layouts: [],
            boundsIssues: [],
          }
      : null;

    preflightElapsedMs.current = performance.now() - startedAt;

    return nextReport;
  }, [prepared, templates, usedTemplates]);
  const profile =
    CANVAS_PROFILES.find(p => p.kind === mode) ?? DEFAULT_IMPRENTA_PROFILE;
  const hasOptimizationResult =
    prepared !== null && report !== null && results.length > 0;
  const resultNeedsRefresh =
    isResultStale || (hasOptimizationResult && usedTemplates !== templates);
  const optimizationReady =
    !resultNeedsRefresh &&
    prepared !== null &&
    report !== null &&
    report.errors.length === 0 &&
    results.length > 0;
  const selectedGarmentCount = useMemo(
    () =>
      garmentCollections.reduce(
        (total, collection) =>
          total +
          GARMENT_SIZES.reduce(
            (subtotal, size) =>
              subtotal + (collectionQuantities[collection.id]?.[size] ?? 0),
            0,
          ),
        0,
      ),
    [collectionQuantities, garmentCollections],
  );
  const orderPreview = useMemo(() => parseOrderText(
    orderText,
    garmentCollections.map(({ id, name }) => ({ id, name })),
    [...replacementPieces, ...freePngs].reduce((total, piece) => total + piece.quantity, 0),
  ), [garmentCollections, freePngs, orderText, replacementPieces]);
  useEffect(() => {
    const urls = ownedUrls.current;
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current?.abort();
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, []);
  const [status, setStatus] = useState<string | null>(null);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimization, setOptimization] =
    useState<BatchOptimizationSummary>(IDLE_OPTIMIZATION);

  useEffect(() => {
    onOptimizationChange?.(optimization);
  }, [onOptimizationChange, optimization]);

  useEffect(() => {
    onExportChange?.(exportActivity);
  }, [exportActivity, onExportChange]);

  useEffect(() => {
    if (
      optimization.status === 'running' &&
      !isOptimizing &&
      prepared &&
      report
    ) {
      if (report.errors.length > 0) {
        const error = report.errors[0] ?? 'La validación del batch falló.';
        setOptimization((current) => ({
          ...current,
          status: 'error',
          phase: 'Error',
          resultAvailable: false,
          error,
        }));
      } else {
        setOptimization({
          status: 'completed',
          progress: 100,
          phase: 'Listo',
          resultAvailable: true,
        });
      }
    }
  }, [isOptimizing, optimization.status, prepared, report]);

  function updateOptimizationProgress(progress: number, phase: string): void {
    setOptimization((current) =>
      current.status === 'running'
        ? {
            ...current,
            progress: Math.max(
              current.progress,
              Math.min(99, Math.max(0, Math.round(progress))),
            ),
            phase,
          }
        : current,
    );
  }

  function markOptimizationStale(): void {
    operation.current?.abort();
    optimizationRunIdRef.current = null;
    setIsResultStale(hasOptimizationResult);
    setExportSucceeded(false);
    setExportActivity(IDLE_EXPORT);
    if (exportSuccessTimer.current !== null) {
      window.clearTimeout(exportSuccessTimer.current);
      exportSuccessTimer.current = null;
    }
    setOptimizationDiagnostics(null);
    setExportDiagnostics(null);
    setStatus(null);
    setOptimization(IDLE_OPTIMIZATION);
  }

  function invalidateFreePngResults(): void {
    markOptimizationStale();
  }

  async function importFreePng(): Promise<void> {
    setIsImportingPng(true);
    try {
      const piece = await chooseFreePng(1);
      if (!piece) return;
      if (!mounted.current) {
        URL.revokeObjectURL(piece.imageUrl);
        return;
      }
      ownedUrls.current.add(piece.imageUrl);
      invalidateFreePngResults();
      setFreePngs((current) => [...current, piece]);
    } catch (error) {
      if (mounted.current)
        setStatus(
          error instanceof Error
            ? error.message
            : 'No se pudo importar el PNG.',
        );
    } finally {
      if (mounted.current) setIsImportingPng(false);
    }
  }

  function updateFreePng(
    id: string,
    patch: Partial<Pick<FreePngDraft, 'quantity' | 'fabric'>>,
  ): void {
    if (patch.quantity !== undefined && !validFreePngQuantity(patch.quantity))
      return;
    invalidateFreePngResults();
    setFreePngs((current) =>
      current.map((piece) =>
        piece.id === id ? { ...piece, ...patch } : piece,
      ),
    );
  }

  function removeFreePng(id: string): void {
    invalidateFreePngResults();
    const piece = freePngs.find((item) => item.id === id);
    if (piece) {
      URL.revokeObjectURL(piece.imageUrl);
      ownedUrls.current.delete(piece.imageUrl);
    }
    setFreePngs((current) => current.filter((piece) => piece.id !== id));
  }

  function toggleFreePngFill(id: string): void {
    const next = toggleFill(freePngs, id, fillActivationCounter.current);
    fillActivationCounter.current = next.lastPriority;
    invalidateFreePngResults();
    setFreePngs(next.pieces);
  }

  function updateCollectionQuantity(
    collectionId: string,
    size: GarmentSize,
    quantity: number,
  ): void {
    const safeQuantity = Number.isSafeInteger(quantity)
      ? Math.max(0, quantity)
      : 0;

    setCollectionQuantities((current) => ({
      ...current,
      [collectionId]: {
        ...current[collectionId],
        [size]: safeQuantity,
      },
    }));

    markOptimizationStale();
  }

  async function addReplacementPiece(): Promise<void> {
    if (addingReplacementRef.current) return;
    const collection = collections.find(item => item.id === replacementCollectionId);
    const asset = collection && findCollectionReplacementAssets(collection, replacementSize, replacementSide)
      .find(candidate => candidate.relativePath === replacementAssetPath);
    const fabric = (replacementPieces.length === 0 && batchFabric.trim()
      ? batchFabric.trim()
      : replacementFabric.trim()) || DEFAULT_PRODUCTION_FABRIC;
    if (!collection || !asset) {
      setReplacementFeedback({ kind: 'error', message: 'Elegí un diseño, talle y lado disponible en Biblioteca.' });
      return;
    }
    if (!validFreePngQuantity(replacementQuantity)) {
      setReplacementFeedback({ kind: 'error', message: 'Ingresá una cantidad entera mayor que cero.' });
      return;
    }

    addingReplacementRef.current = true;
    setIsAddingReplacement(true);
    setReplacementFeedback(null);
    try {
      const image = await createImageBitmap(asset.file);
      try {
        if (!mounted.current) return;
        if (image.width * image.height > MAX_SOURCE_PIXELS) {
          setReplacementFeedback({ kind: 'error', message: `${asset.fileName}: PNG demasiado grande, máximo 16 MP.` });
          return;
        }
        const imageUrl = URL.createObjectURL(asset.file);
        ownedUrls.current.add(imageUrl);
        const replacement: ReplacementPieceDraft = {
          kind: 'replacement-piece',
          id: crypto.randomUUID(),
          collectionId: collection.id,
          model: collection.name,
          size: asset.size,
          side: asset.side,
          fabric,
          quantity: replacementQuantity,
          file: asset.file,
          imageUrl,
          sourceWidthPx: image.width,
          sourceHeightPx: image.height,
        };
        markOptimizationStale();
        setReplacementPieces(current => [...current, replacement]);
        setReplacementFabric(fabric);
        setReplacementQuantity(1);
        setReplacementFeedback({ kind: 'success', message: 'Reposición agregada. Podés cargar otra.' });
        setStatus(null);
      } finally {
        image.close();
      }
    } catch (error) {
      if (mounted.current) {
        setReplacementFeedback({
          kind: 'error',
          message: error instanceof Error ? error.message : 'No se pudo preparar la reposición.',
        });
      }
    } finally {
      addingReplacementRef.current = false;
      if (mounted.current) setIsAddingReplacement(false);
    }
  }

  function updateReplacementPiece(
    id: string,
    patch: Partial<Pick<ReplacementPieceDraft, 'quantity' | 'fabric'>>,
  ): void {
    if (patch.quantity !== undefined && !validFreePngQuantity(patch.quantity)) return;
    markOptimizationStale();
    setReplacementPieces(current => current.map(piece => piece.id === id ? { ...piece, ...patch } : piece));
  }

  function removeReplacementPiece(id: string): void {
    const piece = replacementPieces.find(item => item.id === id);
    if (piece) {
      URL.revokeObjectURL(piece.imageUrl);
      ownedUrls.current.delete(piece.imageUrl);
    }
    markOptimizationStale();
    setReplacementPieces(current => current.filter(piece => piece.id !== id));
  }

  function updatePiece(id: string, patch: Partial<BatchPieceDraft>): void {
    markOptimizationStale();
    setPieces((current) =>
      current.map((piece) =>
        piece.id === id
          ? {
              ...piece,
              ...patch,
            }
          : piece,
      ),
    );

  }

  function removePiece(id: string): void {
    fileVersions.current.set(id, (fileVersions.current.get(id) ?? 0) + 1);
    setPieces((current) => {
      const piece = current.find((item) => item.id === id);

      if (piece?.imageUrl) {
        URL.revokeObjectURL(piece.imageUrl);
      }

      return current.filter((item) => item.id !== id);
    });

    markOptimizationStale();
  }

  function resetCollectionQuantities(): void {
    markOptimizationStale();
    setCollectionQuantities({});

    preflightElapsedMs.current = 0;
  }

  function duplicatePiece(piece: BatchPieceDraft): void {
    const imageUrl = piece.file ? URL.createObjectURL(piece.file) : undefined;
    if (imageUrl) ownedUrls.current.add(imageUrl);
    setPieces((current) => [
      ...current,
      { ...piece, id: crypto.randomUUID(), imageUrl },
    ]);
    markOptimizationStale();
  }

  function handleFileChange(id: string, file: File | undefined): void {
    if (!file) {
      return;
    }

    if (file.type !== 'image/png') {
      setStatus('Solo se permiten archivos PNG.');
      return;
    }

    const version = (fileVersions.current.get(id) ?? 0) + 1;
    fileVersions.current.set(id, version);

    const piece = pieces.find((item) => item.id === id);

    updatePiece(id, {
      file: undefined,
      imageUrl: undefined,
      sourceWidthPx: undefined,
      sourceHeightPx: undefined,
    });

    if (piece?.imageUrl) {
      URL.revokeObjectURL(piece.imageUrl);
      ownedUrls.current.delete(piece.imageUrl);
    }

    const imageUrl = URL.createObjectURL(file);
    ownedUrls.current.add(imageUrl);

    const image = new Image();

    image.onload = () => {
      if (fileVersions.current.get(id) !== version) {
        URL.revokeObjectURL(imageUrl);
        ownedUrls.current.delete(imageUrl);
        return;
      }

      if (image.naturalWidth * image.naturalHeight > MAX_SOURCE_PIXELS) {
        URL.revokeObjectURL(imageUrl);
        ownedUrls.current.delete(imageUrl);

        setStatus('PNG demasiado grande: máximo 16 MP.');
        return;
      }

      updatePiece(id, {
        file,
        imageUrl,
        sourceWidthPx: image.naturalWidth,
        sourceHeightPx: image.naturalHeight,
      });

      setStatus(null);
    };

    image.onerror = () => {
      URL.revokeObjectURL(imageUrl);
      ownedUrls.current.delete(imageUrl);
      setStatus('No se pudo leer el PNG seleccionado.');
    };

    image.src = imageUrl;
  }

  async function optimizeBatch(
    inputPieces: readonly BatchPieceDraft[] = pieces,
    diagnosticContext: {
      readonly runStartedAt: number;
      readonly collectionPreparationMs: number;
    },
    controller: AbortController,
  ): Promise<void> {
    const runStartedAt = diagnosticContext.runStartedAt;
    const allInputPieces: readonly ProductionPieceDraft[] = [
      ...inputPieces,
      ...replacementPieces,
      ...freePngs,
    ];

    const collectionPreparationMs =
      diagnosticContext.collectionPreparationMs;

    setOptimizationDiagnostics(null);
    setExportDiagnostics(null);
    setStatus(null);
    optimizationRunIdRef.current = null;
    setIsResultStale(hasOptimizationResult);

    for (const piece of allInputPieces) {
      const error = validateDraft(piece);

      if (error) {
        setStatus(error);
        setOptimization({
          status: 'error',
          progress: 0,
          phase: 'Error',
          resultAvailable: false,
          error,
        });
        setIsOptimizing(false);
        if (operation.current === controller) operation.current = null;
        return;
      }
    }

    const batchPieceLimitError = getBatchPieceLimitError(allInputPieces);
    if (batchPieceLimitError) {
      const error = batchPieceLimitError;
      setStatus(error);
      setOptimization({
        status: 'error',
        progress: 0,
        phase: 'Error',
        resultAvailable: false,
        error,
      });
      setIsOptimizing(false);
      if (operation.current === controller) operation.current = null;
      return;
    }

    try {
      const definitionsStartedAt = performance.now();
      const definitions: BatchPieceDefinition[] = allInputPieces.map(
        (piece) => {
          if (
            !piece.file ||
            !piece.imageUrl ||
            !piece.sourceWidthPx ||
            !piece.sourceHeightPx
          ) {
            throw new Error('El batch contiene una pieza incompleta.');
          }

          const template =
            piece.kind !== 'free-png'
              ? findTemplateForDraft(piece, templates)
              : undefined;

          const physicalSize = physicalSizeFromSourcePixels(
            piece.sourceWidthPx,
            piece.sourceHeightPx,
          );

          return {
            ...(piece.kind === 'free-png'
              ? {
                  kind: 'free-png' as const,
                  ...(piece.fill ? { fill: piece.fill } : {}),
                }
              : piece.kind === 'replacement-piece'
              ? {
                  kind: 'replacement-piece' as const,
                  collectionId: piece.collectionId,
                  model: piece.model.trim(),
                  size: piece.size,
                  side: piece.side,
                }
              : {
                  kind: 'garment' as const,
                  model: piece.model.trim(),
                  size: piece.size,
                  side: piece.side,
                }),
            id: piece.id,
            fabric: piece.fabric.trim(),
            quantity: piece.quantity,
            fileName: piece.file.name,
            imageUrl: piece.imageUrl,
            sourceWidthPx: piece.sourceWidthPx,
            sourceHeightPx: piece.sourceHeightPx,
            physicalWidthMm: mm(physicalSize.widthMm),
            physicalHeightMm: mm(physicalSize.heightMm),
            alphaThreshold: template?.alphaThreshold ?? DEFAULT_ALPHA_THRESHOLD,
            simplificationTolerancePx: FAST_SIMPLIFICATION_PX,
          };
        },
      );
      const definitionBuildMs = performance.now() - definitionsStartedAt;
      updateOptimizationProgress(2, 'Preparando');
      const contoursStartedAt = performance.now();
      const polygonByDefinitionId = new Map<string, Polygon>();
      const finePolygonByDefinitionId = new Map<string, Polygon>();
      const componentsByDefinitionId = new Map<string, readonly Polygon[]>();
      const sourceAlphaBoundsByDefinitionId = new Map<
        string,
        AlphaPixelBounds
      >();
      const sourcePlacementBoundsByDefinitionId = new Map<
        string,
        AlphaPixelBounds
      >();

      const cutComponentsByDefinitionId = new Map<string, readonly Polygon[]>();
      const sourceFileByDefinitionId = new Map<string, File>();

      for (const piece of allInputPieces) {
        if (!piece.file) {
          throw new Error(`Falta el archivo fuente de la pieza ${piece.id}.`);
        }

        sourceFileByDefinitionId.set(piece.id, piece.file);
      }

      for (const definition of definitions) {
        const file = sourceFileByDefinitionId.get(definition.id);

        if (!file) {
          throw new Error(
            `No se encontró el archivo fuente de ${definition.fileName}.`,
          );
        }

        const {
          cutComponents,
          fastPolygon,
          finePolygon,
          collisionComponents,
          sourceAlphaBounds,
          sourcePlacementBounds,
        } =
          await polygonsFromDefinition(definition, file, Boolean(profile.laserCutOutline));

        if (cutComponents) cutComponentsByDefinitionId.set(definition.id, cutComponents);
        polygonByDefinitionId.set(definition.id, fastPolygon);

        finePolygonByDefinitionId.set(definition.id, finePolygon);
        sourceAlphaBoundsByDefinitionId.set(
          definition.id,
          sourceAlphaBounds,
        );
        sourcePlacementBoundsByDefinitionId.set(
          definition.id,
          sourcePlacementBounds,
        );
        if (collisionComponents)
          componentsByDefinitionId.set(definition.id, collisionComponents);
      }
      const contourExtractionMs = performance.now() - contoursStartedAt;
      updateOptimizationProgress(4, 'Preparando');
      const groupingStartedAt = performance.now();
      const instances = expandPieceDefinitions(definitions);
      const fabricGroups = groupPiecesByFabric(instances);
      const groupingMs = performance.now() - groupingStartedAt;
      updateOptimizationProgress(5, 'Acomodando piezas');

      const nextResults: FabricBatchResult[] = [];
      const engineProfiles: { fabric: string; profile: NestingProfile }[] = [];
      let nestingRoundTripMs = 0;
      let nestingWorkerMs = 0;
      let nestingOverheadMs = 0;
      let requiredMs = 0;
      let fillerMs = 0;

      let candidatePlacementsTested = 0;
      let polygonTransforms = 0;
      let polygonTranslations = 0;
      let broadPhaseChecks = 0;
      let exactPolygonCollisionChecks = 0;
      let layoutsCreated = 0;
      let candidateCacheHits = 0;

      let completedRequiredBeforeGroup = 0;
      const totalRequiredPieces = instances.length;

      for (const group of fabricGroups) {
        const fillers = fillersForInstances(group.pieces);
        const nestingPieces: MultiNestingPiece[] = group.pieces.map(
          (instance: PieceInstance) => {
            const polygon = polygonByDefinitionId.get(instance.definitionId);
            const finePolygon = finePolygonByDefinitionId.get(
              instance.definitionId,
            );
            const collisionComponents = componentsByDefinitionId.get(
              instance.definitionId,
            );

            if (!polygon || !finePolygon) {
              throw new Error(`No se encontró la geometría de ${instance.id}.`);
            }

            return {
              ...(fillers.length
                ? {
                    artworkSize: {
                      width: instance.definition.physicalWidthMm,
                      height: instance.definition.physicalHeightMm,
                    },
                  }
                : {}),
              ...(cutComponentsByDefinitionId.has(instance.definitionId) ? {
                cutComponents: cutComponentsByDefinitionId.get(instance.definitionId)!,
                cutAnchor: (() => {
                  const b = sourcePlacementBoundsByDefinitionId.get(instance.definitionId)!;
                  const sx=instance.definition.physicalWidthMm/instance.definition.sourceWidthPx;
                  const sy=instance.definition.physicalHeightMm/instance.definition.sourceHeightPx;
                  return [{x:b.x*sx,y:b.y*sy},{x:(b.x+b.width)*sx,y:b.y*sy},
                    {x:(b.x+b.width)*sx,y:(b.y+b.height)*sy},{x:b.x*sx,y:(b.y+b.height)*sy}];
                })(),
              } : {}),
              id: instance.id,
              kind: instance.definition.kind === 'free-png' ? 'free-png' : 'garment',
              polygon,
              finePolygon,
              ...(collisionComponents ? { collisionComponents } : {}),
              allowedRotations: getAllowedRotationsForPiece(
                instance.definition,
              ),
            };
          },
        );

        let workerTiming: NestingWorkerTiming | undefined;
        const groupProgressStart =
          5 + (90 * completedRequiredBeforeGroup) / totalRequiredPieces;
        const groupProgressSpan =
          (90 * group.pieces.length) / totalRequiredPieces;
        const requiredProgressSpan = fillers.length
          ? groupProgressSpan * (70 / 90)
          : groupProgressSpan;
        const fillerProgressSpan = groupProgressSpan - requiredProgressSpan;
        const reportWorkerProgress = (progress: NestingProgress) => {
          if (progress.phase === 'preparing') {
            updateOptimizationProgress(
              groupProgressStart,
              'Acomodando piezas',
            );
          } else if (progress.phase === 'required') {
            updateOptimizationProgress(
              groupProgressStart +
                requiredProgressSpan * (progress.completed / progress.total),
              'Acomodando piezas',
            );
          } else if (progress.phase === 'fillers') {
            updateOptimizationProgress(
              groupProgressStart +
                requiredProgressSpan +
                fillerProgressSpan * (progress.completed / progress.total),
              'Completando espacios',
            );
          } else {
            updateOptimizationProgress(
              groupProgressStart + groupProgressSpan,
              'Validando',
            );
          }
        };

        const startedAt = performance.now();

        const result = await nestInWorker(
          {
            pieces: nestingPieces,
            diagnosticPhaseTiming: true,
            ...(fillers.length ? { fillers } : {}),
            canvas: nestingCanvasForProfile(profile),
            scanStepMm: DEFAULT_SCAN_STEP_MM,
          },
          controller.signal,
          (timing) => {
            workerTiming = timing;
          },
          reportWorkerProgress,
        );
        completedRequiredBeforeGroup += group.pieces.length;

        const elapsedMs = performance.now() - startedAt;
        if (workerTiming) {
          nestingRoundTripMs += workerTiming.roundTripMs;

          nestingWorkerMs += workerTiming.workerMs;

          nestingOverheadMs += workerTiming.overheadMs;
        }

        const engineDiagnostics = result.diagnostics;
        if (engineDiagnostics?.profile)
          engineProfiles.push({
            fabric: group.fabric,
            profile: engineDiagnostics.profile,
          });

        if (engineDiagnostics) {
          requiredMs += engineDiagnostics.requiredMs;
          fillerMs += engineDiagnostics.fillerMs;

          candidatePlacementsTested +=
            engineDiagnostics.candidatePlacementsTested;

          polygonTransforms += engineDiagnostics.polygonTransforms;

          polygonTranslations += engineDiagnostics.polygonTranslations;

          broadPhaseChecks += engineDiagnostics.broadPhaseChecks;

          exactPolygonCollisionChecks +=
            engineDiagnostics.exactPolygonCollisionChecks;

          layoutsCreated += engineDiagnostics.layoutsCreated;

          candidateCacheHits += engineDiagnostics.candidateCacheHits;
        }

        nextResults.push({
          fabric: group.fabric,
          layouts: result.layouts,
          unplacedPieceIds: result.unplacedPieceIds,
          elapsedMs,
        });
      }

      controller.signal.throwIfAborted();
      updateOptimizationProgress(96, 'Validando');
      const nextPrepared: PreparedBatch = {
        definitions,
        polygons: polygonByDefinitionId,
        collisionPolygons: finePolygonByDefinitionId,
        cutComponents: cutComponentsByDefinitionId,
        sourceAlphaBounds: sourceAlphaBoundsByDefinitionId,
        sourcePlacementBounds: sourcePlacementBoundsByDefinitionId,
        results: nextResults,
        profile,
      };

      optimizationRunIdRef.current = crypto.randomUUID();

      setPrepared(nextPrepared);
      setUsedTemplates(templates);
      setResults(nextResults);
      setIsResultStale(false);
      setStatus(null);
      setOptimizationDiagnostics({
        profileName: profile.name,
        profileWidthMm: profile.maxWidth,
        profileHeightMm: profile.maxHeight,
        engineProfiles,
        collectionPreparationMs,
        definitionBuildMs,
        contourExtractionMs,
        groupingMs,

        nestingRoundTripMs,
        nestingWorkerMs,
        nestingOverheadMs,
        requiredMs,
        fillerMs,

        totalBeforePreflightMs: performance.now() - runStartedAt,

        definitions: definitions.length,
        expandedPieces: instances.length,
        fabricGroups: fabricGroups.length,

        candidatePlacementsTested,
        polygonTransforms,
        polygonTranslations,
        broadPhaseChecks,
        exactPolygonCollisionChecks,
        layoutsCreated,
        candidateCacheHits,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Ocurrió un error al optimizar el batch.';
      const cancelled = controller.signal.aborted;
      setStatus(message);
      setOptimization((current) => ({
        status: cancelled ? 'cancelled' : 'error',
        progress: current.progress,
        phase: cancelled ? 'Cancelado' : 'Error',
        resultAvailable: false,
        ...(cancelled ? {} : { error: message }),
      }));
    } finally {
      setIsOptimizing(false);
      if (operation.current === controller) operation.current = null;
    }
  }

  async function optimizeCollections(): Promise<void> {
    if (isOptimizing || operation.current) return;

    const runStartedAt = performance.now();

    setOptimizationDiagnostics(null);
    setExportDiagnostics(null);
    const fabric = batchFabric.trim();

    if (selectedGarmentCount > 0 && !fabric) {
      setStatus('Elegí un tipo de tela para el batch.');
      return;
    }

    const controller = new AbortController();
    operation.current = controller;
    setIsOptimizing(true);
    setOptimization({
      status: 'running',
      progress: 0,
      phase: 'Preparando',
      resultAvailable: false,
    });

    const generatedPieces: BatchPieceDraft[] = [];

    try {
      for (const collection of garmentCollections) {
        for (const size of GARMENT_SIZES) {
            const quantity = collectionQuantities[collection.id]?.[size] ?? 0;

          if (quantity <= 0) {
            continue;
          }

          if (!Number.isSafeInteger(quantity)) {
            throw new Error(`Cantidad inválida en ${collection.name} ${size}.`);
          }

            for (const side of PIECE_SIDES) {
              controller.signal.throwIfAborted();
              const asset = findCollectionAsset(collection, size, side);

            if (!asset) {
              throw new Error(
                `${collection.name}: falta ${size} ${getPieceSideLabel(side)}.`,
              );
            }

            const image = await createImageBitmap(asset.file);

            try {
              if (image.width * image.height > MAX_SOURCE_PIXELS) {
                throw new Error(
                  `${asset.fileName}: PNG demasiado grande, máximo 16 MP.`,
                );
              }

              const imageUrl = URL.createObjectURL(asset.file);
              ownedUrls.current.add(imageUrl);

              generatedPieces.push({
                kind: 'garment',
                id: crypto.randomUUID(),
                model: collection.name,
                size,
                side,
                fabric,
                quantity,
                file: asset.file,
                imageUrl,
                sourceWidthPx: image.width,
                sourceHeightPx: image.height,
              });
            } finally {
              image.close();
            }
          }
        }
      }

      if (generatedPieces.length === 0 && freePngs.length === 0 && replacementPieces.length === 0) {
        throw new Error('Ingresá al menos una cantidad mayor que cero.');
      }
      controller.signal.throwIfAborted();

      /*
       * Liberamos URLs del batch anterior antes de sustituirlo.
       */
      for (const piece of pieces) {
        if (piece.imageUrl && ownedUrls.current.has(piece.imageUrl)) {
          URL.revokeObjectURL(piece.imageUrl);
          ownedUrls.current.delete(piece.imageUrl);
        }
      }

      setPieces(generatedPieces);

      const collectionPreparationMs = performance.now() - runStartedAt;

      await optimizeBatch(
        generatedPieces,
        {
          runStartedAt,
          collectionPreparationMs,
        },
        controller,
      );
    } catch (error) {
      for (const piece of generatedPieces) {
        if (piece.imageUrl) {
          URL.revokeObjectURL(piece.imageUrl);
          ownedUrls.current.delete(piece.imageUrl);
        }
      }

      const message =
        error instanceof Error ? error.message : 'No se pudo preparar el batch.';
      const cancelled = controller.signal.aborted;
      setStatus(message);
      setOptimization((current) => ({
        status: cancelled ? 'cancelled' : 'error',
        progress: current.progress,
        phase: cancelled ? 'Cancelado' : 'Error',
        resultAvailable: false,
        ...(cancelled ? {} : { error: message }),
      }));
      setIsOptimizing(false);
      if (operation.current === controller) operation.current = null;
    }
  }

  async function exportPdf(): Promise<void> {
    if (!prepared || !optimizationReady || isExporting || isOptimizing) {
      return;
    }

    if (exportSuccessTimer.current !== null) {
      window.clearTimeout(exportSuccessTimer.current);

      exportSuccessTimer.current = null;
    }

    setExportSucceeded(false);
    setIsExporting(true);
    setStatus('Preparando exportación PDF…');
    setExportActivity({
      status: 'running',
      phase: 'Exportando archivos',
    });

    const controller = new AbortController();

    operation.current = controller;

    try {
      const paths = await exportPdfPrototype(
        prepared,
        controller.signal,
        setStatus,
      );

      if (paths.length > 0) {
        /*
         * El propio botón confirma visualmente
         * el éxito. No llenamos la página con
         * todas las rutas de salida.
         */
        setStatus(null);
        setExportSucceeded(true);
        setExportActivity({
          status: 'completed',
          phase: 'Exportación terminada',
        });

        const historyReport = preflightBatch(prepared);
        if (optimizationRunIdRef.current && historyReport.errors.length === 0) {
          const previewFiles = await buildHistoricalBatchPreviewFiles(
            historyReport.layouts,
            controller.signal,
          );
          controller.signal.throwIfAborted();
          recordOptimizedBatch({
            optimizationRunId: optimizationRunIdRef.current,
            createdAt: Date.now(),
            canvasCount: prepared.results.reduce(
              (total, result) => total + result.layouts.length,
              0,
            ),
            fabrics: prepared.results.map((result) => ({
              fabric: result.fabric,
              meters:
                result.layouts.reduce(
                  (total, layout) => total + layout.usedHeight,
                  0,
                ) / 1000,
            })),
            files: previewFiles,
            sizeSummary: buildHistoricalSizeSummary(prepared.definitions),
            freePngPieces: pngPieceSummaries(prepared.definitions),
            extraPieces: pngPieceSummaries(
              prepared.definitions,
              extraCounts(prepared.results),
            ),
          });
        }

        exportSuccessTimer.current = window.setTimeout(() => {
          setExportSucceeded(false);

          exportSuccessTimer.current = null;
        }, 10_000);
      } else {
        setStatus('Exportación cancelada; no se guardaron archivos.');
        setExportActivity({
          status: 'cancelled',
          phase: 'Exportación cancelada',
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const cancelled = controller.signal.aborted;
      setStatus(message);
      setExportActivity({
        status: cancelled ? 'cancelled' : 'error',
        phase: cancelled ? 'Exportación cancelada' : 'Error al exportar',
        ...(cancelled ? {} : { error: message }),
      });
    } finally {
      setIsExporting(false);

      if (operation.current === controller) {
        operation.current = null;
      }
    }
  }

  function applyOrderImport(): void {
    if (!orderPreview.confirmable) return;
    setCollectionQuantities(quantitiesFromOrder(orderPreview, garmentCollections));
    markOptimizationStale();
    setOrderImportOpen(false);
    setOrderShowPreview(false);
  }

  return (
    <section className="batch-page">
      <fieldset
        disabled={isOptimizing || isExporting || isImportingPng}
        style={{ border: 0, padding: 0, margin: 0 }}
      >
        <header className="production-header">
          <div className="production-title">
            <p className="page-kicker">NUEVO BATCH</p>
            <h1>Producción</h1>
            <p>Elegí diseños, definí cantidades y prepará el layout final.</p>
          </div>
        </header>

        <div className="batch-section-heading">
          <span>01</span>
          <div>
            <h2>Batch</h2>
            <p>Diseños requeridos y cantidades por talle.</p>
          </div>
        </div>

        <section className="collection-batch-browser">
          <div className="collection-browser-heading">
            {garmentCollections.length > 0 ? (
              <button
                type="button"
                className="collection-quantities-reset-button"
                aria-label="Resetear cantidades"
                title="Resetear cantidades"
                onClick={() => setResetQuantitiesPending(true)}
              >
                ↺
              </button>
            ) : null}
          </div>

          {garmentCollections.length === 0 && freePngs.length === 0 && replacementPieces.length === 0 ? (
            <div className="empty-state production-empty">
              <span className="status-badge">PENDIENTE</span>
              <h2>No hay piezas en el batch</h2>
              <p>Elegí un diseño o agregá un PNG para empezar.</p>
            </div>
          ) : (
            <div className="collection-batch-grid">
              {[...garmentCollections]
                .sort((a, b) =>
                  a.name.localeCompare(b.name, 'es', {
                    sensitivity: 'base',
                    numeric: true,
                  }),
                )
                .map((collection) => {
                  return (
                    <article
                      key={collection.id}
                      className="collection-batch-card"
                    >
                      <div className="collection-batch-card-header">
                        <div className="collection-previews">
                          <AssetPreview
                            asset={findCollectionPreviewAsset(
                              collection,
                              'front',
                            )}
                            label="Frente"
                          />
                          <AssetPreview
                            asset={findCollectionPreviewAsset(
                              collection,
                              'back',
                            )}
                            label="Dorso"
                          />
                        </div>
                        <div>
                          <h3>{collection.name}</h3>
                        </div>
                        {GARMENT_SIZES.some(
                          (size) =>
                            !findCollectionAsset(collection, size, 'front') ||
                            !findCollectionAsset(collection, size, 'back'),
                        ) ? (
                          <span
                            className="collection-error"
                            title="La colección no está completa: faltan talles o lados (frente/dorso)."
                            aria-label="La colección no está completa"
                          >
                            ⚠
                          </span>
                        ) : null}
                      </div>

                      <div className="collection-size-quantities">
                        {GARMENT_SIZES.map((size) => {
                          const front = findCollectionAsset(
                            collection,
                            size,
                            'front',
                          );

                          const back = findCollectionAsset(
                            collection,
                            size,
                            'back',
                          );

                          const complete = Boolean(front && back);
                          const quantity =
                            collectionQuantities[collection.id]?.[size] ?? 0;

                          return (
                            <div key={size} className="collection-quantity-row">
                              <button
                                type="button"
                                className="size-step-button"
                                disabled={!complete}
                                aria-label={`Agregar una prenda ${size}`}
                                onClick={() =>
                                  updateCollectionQuantity(
                                    collection.id,
                                    size,
                                    quantity + 1,
                                  )
                                }
                              >
                                {size}
                              </button>

                              <input
                                type="number"
                                min="0"
                                max="999"
                                step="1"
                                disabled={!complete}
                                value={quantity}
                                aria-label={`Cantidad ${size}`}
                                onDoubleClick={(event) =>
                                  event.currentTarget.select()
                                }
                                onChange={(event) =>
                                  updateCollectionQuantity(
                                    collection.id,
                                    size,
                                    Number(event.target.value) || 0,
                                  )
                                }
                              />

                              <button
                                type="button"
                                className="size-decrement-button"
                                disabled={!complete || quantity === 0}
                                aria-label={`Restar una prenda ${size}`}
                                onClick={() =>
                                  updateCollectionQuantity(
                                    collection.id,
                                    size,
                                    Math.max(0, quantity - 1),
                                  )
                                }
                              >
                                −
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </article>
                  );
                })}
            </div>
          )}
          {collections.length ? (
            <div className="production-order-import-slot">
              <button
                type="button"
                className="secondary-button production-order-import"
                onClick={() => { setOrderText(''); setOrderShowPreview(false); setOrderImportOpen(true); }}
              >
                Importar pedido
              </button>
            </div>
          ) : null}
        </section>

        {replacementPieces.length > 0 ? (
          <section className="replacement-piece-list" aria-label="Piezas de reposición">
            <h3>Reposiciones</h3>
            <ul className="free-png-list">
              {replacementPieces.map(piece => (
                <li className="free-png-row" key={piece.id}>
                  <img src={piece.imageUrl} alt={`${piece.model} ${piece.size} ${getPieceSideLabel(piece.side)}`} />
                  <strong>{piece.model} · {piece.size} · {getPieceSideLabel(piece.side)}</strong>
                  <span>{piece.file.name}</span>
                  <label>Cantidad <input type="number" min="1" step="1" value={piece.quantity} onChange={event => updateReplacementPiece(piece.id, { quantity: Number(event.target.value) || 0 })} /></label>
                  <label>Tela <input type="text" value={piece.fabric} onChange={event => updateReplacementPiece(piece.id, { fabric: event.target.value })} /></label>
                  <button className="free-png-remove" type="button" aria-label={`Eliminar reposición ${piece.model} ${piece.size} ${getPieceSideLabel(piece.side)}`} onClick={() => removeReplacementPiece(piece.id)}>×</button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="replacement-piece-entry" aria-labelledby="replacement-piece-entry-title">
          <div className="batch-section-heading replacement-piece-entry-heading">
            <div>
              <h2 id="replacement-piece-entry-title">Agregar dorso/frente</h2>
              <p>Elegí un diseño y un archivo personalizado de Biblioteca.</p>
            </div>
          </div>
          <form
            id="replacement-piece-form"
            className="replacement-piece-form"
            aria-label="Agregar reposición"
            noValidate
            onSubmit={event => { event.preventDefault(); void addReplacementPiece(); }}
          >
            <fieldset disabled={isAddingReplacement || isOptimizing || collections.length === 0}>
              <label>Diseño
                <select
                  value={replacementCollectionId}
                  onChange={event => {
                    setReplacementCollectionId(event.target.value);
                    setReplacementFeedback(null);
                  }}
                >
                  {[...collections].sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base', numeric: true })).map(collection => <option key={collection.id} value={collection.id}>{collection.name}</option>)}
                </select>
              </label>
              <label>Talle
                <select value={replacementSize} onChange={event => {
                  const size = event.target.value as GarmentSize;
                  setReplacementSize(size);
                  setReplacementFeedback(null);
                }}>
                  {GARMENT_SIZES.map(size => <option key={size} value={size} disabled={!replacementCollection || !PIECE_SIDES.some(side => findCollectionReplacementAssets(replacementCollection, size, side).length)}>{size}</option>)}
                </select>
              </label>
              <label>Lado
                <select value={replacementSide} onChange={event => { setReplacementSide(event.target.value as (typeof PIECE_SIDES)[number]); setReplacementFeedback(null); }}>
                  {PIECE_SIDES.map(side => {
                    const available = Boolean(replacementCollection && findCollectionReplacementAssets(replacementCollection, replacementSize, side).length);
                    return <option key={side} value={side} disabled={!available}>{getPieceSideLabel(side)}</option>;
                  })}
                </select>
              </label>
              <label className="replacement-piece-form__asset">Archivo de Biblioteca
                <select value={replacementAssetPath} onChange={event => { setReplacementAssetPath(event.target.value); setReplacementFeedback(null); }}>
                  {replacementAssetOptions.map(asset => <option key={asset.relativePath} value={asset.relativePath}>{asset.relativePath}</option>)}
                </select>
              </label>
              <label>Cantidad
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={replacementQuantity}
                  onChange={event => { setReplacementQuantity(Number(event.target.value) || 0); setReplacementFeedback(null); }}
                />
              </label>
              <div className="replacement-piece-form__actions">
                <button type="submit" className="batch-primary-button" disabled={isAddingReplacement || isOptimizing || !replacementCollection || replacementAssetOptions.length === 0}>
                  {isAddingReplacement ? 'Agregando…' : 'Agregar pieza'}
                </button>
              </div>
            </fieldset>
            {!replacementAssetOptions.length ? (
              <p className="replacement-piece-empty-hint" role="status">La Biblioteca no tiene archivos personalizados de frente o dorso para esta selección.</p>
            ) : null}
            {replacementFeedback ? (
              <p className={`replacement-feedback is-${replacementFeedback.kind}`} role={replacementFeedback.kind === 'error' ? 'alert' : 'status'}>
                {replacementFeedback.message}
              </p>
            ) : null}
          </form>
        </section>

        <FreePngPanel
          pieces={freePngs}
          onImport={() => void importFreePng()}
          onUpdate={updateFreePng}
          onRemove={removeFreePng}
          onToggleFill={toggleFreePngFill}
          extras={optimizationReady ? extraCounts(results) : undefined}
        />

        {resetQuantitiesPending ? (
          <div
            className="confirm-backdrop"
            role="presentation"
            onMouseDown={() => setResetQuantitiesPending(false)}
          >
            <div
              className="confirm-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="reset-quantities-title"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <h3 id="reset-quantities-title">Resetear cantidades</h3>

              <p>
                ¿Querés poner en 0 las cantidades de todos los talles en
                Producción?
              </p>

              <div className="confirm-dialog-actions">
                <button
                  type="button"
                  className="confirm-cancel-button"
                  onClick={() => setResetQuantitiesPending(false)}
                >
                  CANCELAR
                </button>

                <button
                  type="button"
                  className="confirm-delete-button"
                  onClick={() => {
                    resetCollectionQuantities();
                    setResetQuantitiesPending(false);
                  }}
                >
                  RESETEAR
                </button>
              </div>
            </div>
          </div>
        ) : null}
        <details className="manual-batch" hidden>
          <summary>Carga manual avanzada</summary>
          <div className="batch-table-wrapper">
            <table className="batch-table">
              <thead>
                <tr>
                  <th>Modelo</th>
                  <th>Talle</th>
                  <th>Lado</th>
                  <th>Tela</th>
                  <th>Cant.</th>
                  <th>PNG / Calibración</th>
                  <th />
                </tr>
              </thead>

              <tbody>
                {pieces.map((piece) => (
                  <tr key={piece.id}>
                    <td>
                      <input
                        type="text"
                        value={piece.model}
                        placeholder="River"
                        onChange={(event) =>
                          updatePiece(piece.id, {
                            model: event.target.value,
                          })
                        }
                      />
                    </td>

                    <td>
                      <select
                        value={piece.size}
                        onChange={(event) =>
                          updatePiece(piece.id, {
                            size: event.target.value as BatchPieceDraft['size'],
                          })
                        }
                      >
                        {GARMENT_SIZES.map((size) => (
                          <option key={size} value={size}>
                            {size}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td>
                      <select
                        value={piece.side}
                        onChange={(event) =>
                          updatePiece(piece.id, {
                            side: event.target.value as BatchPieceDraft['side'],
                          })
                        }
                      >
                        {PIECE_SIDES.map((side) => (
                          <option key={side} value={side}>
                            {getPieceSideLabel(side)}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td>
                      <input
                        type="text"
                        value={piece.fabric}
                        placeholder="deportiva"
                        onChange={(event) =>
                          updatePiece(piece.id, {
                            fabric: event.target.value,
                          })
                        }
                      />
                    </td>

                    <td>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={piece.quantity}
                        onChange={(event) =>
                          updatePiece(piece.id, {
                            quantity: Math.max(
                              1,
                              Number(event.target.value) || 1,
                            ),
                          })
                        }
                      />
                    </td>

                    <td>
                      <input
                        type="file"
                        accept="image/png"
                        onChange={(event) =>
                          handleFileChange(piece.id, event.target.files?.[0])
                        }
                      />

                      <span>
                        {findTemplateForDraft(piece, templates)
                          ?.physicalWidthMm &&
                        findTemplateForDraft(piece, templates)?.physicalHeightMm
                          ? 'Calibrada'
                          : 'Sin calibrar'}
                      </span>
                      {piece.file ? (
                        <span className="batch-file-name">
                          {piece.file.name}
                        </span>
                      ) : null}
                    </td>

                    <td>
                      <button
                        className="batch-remove-button"
                        type="button"
                        disabled={pieces.length === 1}
                        onClick={() => removePiece(piece.id)}
                        aria-label="Eliminar pieza"
                      >
                        ×
                      </button>
                      <button
                        type="button"
                        onClick={() => duplicatePiece(piece)}
                      >
                        Duplicar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>

        <section className="batch-final-config" aria-label="Configuración del batch">
          <p className="batch-selection-summary">
            {selectedGarmentCount} prendas seleccionadas · cada prenda genera
            automáticamente un frente y un dorso.
            {replacementPieces.length > 0
              ? ` · ${replacementPieces.reduce((total, piece) => total + piece.quantity, 0)} piezas de reposición`
              : ''}
          </p>
          <div className="production-context">
            <label className="production-fabric-field">
              <span>TELA DEL BATCH</span>
              <input
                type="text"
                aria-label="Tipo de tela para todo el batch"
                value={batchFabric}
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="none"
                onChange={(event) => {
                  setBatchFabric(event.target.value);
                  markOptimizationStale();
                }}
              />
            </label>
            <div className="segmented-toggle" aria-label="Perfil de salida">
              {CANVAS_PROFILES.map((selectedProfile) => {
                const option = selectedProfile.kind;
                return (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={mode === option}
                    title={selectedProfile.minimumVisibleGapMm ? `${selectedProfile.maxWidth / 10}×${selectedProfile.maxHeight / 10} cm · espacio libre entre contornos ${selectedProfile.minimumVisibleGapMm} mm` : undefined}
                    className={mode === option ? 'selected' : ''}
                    onClick={() => {
                      if (option === mode) return;
                      operation.current?.abort();
                      if (exportSuccessTimer.current !== null) window.clearTimeout(exportSuccessTimer.current);
                      setMode(option);
                      markOptimizationStale();
                      preflightElapsedMs.current = 0;
                    }}
                  >
                    {selectedProfile.name}
                  </button>
                );
              })}
            </div>
          </div>
          <button
            className="batch-primary-button production-primary-action"
            type="button"
            disabled={isOptimizing}
            onClick={() => void optimizeCollections()}
          >
            {isOptimizing ? 'OPTIMIZANDO…' : 'Optimizar batch'}
            <span aria-hidden="true">→</span>
          </button>
        </section>

      </fieldset>

      {orderImportOpen ? (
        <div className="confirm-backdrop order-import-backdrop" role="presentation" onMouseDown={() => setOrderImportOpen(false)}>
          <section
            className="confirm-dialog order-import-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="order-import-title"
            onMouseDown={event => event.stopPropagation()}
          >
            <h2 id="order-import-title">Importar pedido</h2>
            <p>Este pedido reemplazará todas las cantidades actuales de prendas. Reposiciones y PNG libres se conservan.</p>
            <label className="order-import-input-label" htmlFor="order-import-text">Pegá las entradas separadas por punto y coma</label>
            <textarea
              id="order-import-text"
              value={orderText}
              onChange={event => setOrderText(event.target.value)}
              spellCheck={false}
              placeholder={'Boca 2026 t1=3, t2=3, t3=3; Racing 2026 t7=1;'}
            />
            <details className="order-import-help">
              <summary aria-label="Ver formato esperado">
                <span className="order-import-help-icon" aria-hidden="true">?</span>
                <span>Formato esperado</span>
              </summary>
              <div className="order-import-help-popover">
                <strong>Separá cada diseño con punto y coma</strong>
                <code>Boca 2026 t1=3, t2=3, t3=3; Racing 2026 t7=1;</code>
                <span>Los talles no incluidos quedan en 0. Se aceptan t1 a t10, sin distinguir mayúsculas.</span>
              </div>
            </details>
            <button type="button" className="secondary-button" onClick={() => setOrderShowPreview(true)}>Validar / preview</button>
            {orderShowPreview ? (
              <div className="order-import-preview" aria-live="polite">
                <div className="order-import-totals">
                  <span>{orderPreview.lines.filter(line => line.collectionId).length} diseños reconocidos</span>
                  <span>{orderPreview.lines.filter(line => !line.collectionId).length} diseños sin match inequívoco</span>
                  <span>{orderPreview.lines.filter(line => line.errors.length).length} entradas con errores</span>
                  <span>{orderPreview.totalGarments} prendas · {orderPreview.totalPieces} piezas totales</span>
                </div>
                {orderPreview.lines.map(line => (
                  <div className={`order-import-line${line.errors.length ? ' has-error' : ''}`} key={line.entryNumber}>
                    <strong>{line.designName || `Entrada ${line.entryNumber}`}</strong>
                    {line.collectionId ? <span>{GARMENT_SIZES.filter(size => line.quantities[size] > 0).map(size => `${size}=${line.quantities[size]}`).join(' · ') || 'sin cantidades (todo quedará en 0)'}</span> : null}
                    {line.errors.map((error, index) => <span className="order-import-error" key={`${index}-${error}`}>{error}</span>)}
                    {line.suggestions.length ? <span>Sugerencias: {line.suggestions.join(', ')}</span> : null}
                  </div>
                ))}
                {orderPreview.errors.filter(error => !error.startsWith('Entrada ')).map((error, index) => (
                  <p className="order-import-error" role="alert" key={`${index}-${error}`}>{error}</p>
                ))}
              </div>
            ) : null}
            <div className="confirm-dialog-actions">
              <button type="button" className="confirm-cancel-button" onClick={() => setOrderImportOpen(false)}>CANCELAR</button>
              <button type="button" className="batch-primary-button order-import-submit" disabled={!orderShowPreview || !orderPreview.confirmable} onClick={applyOrderImport}>Importar</button>
            </div>
          </section>
        </div>
      ) : null}

      <div className="batch-production-flow batch-production-flow-after">
        {isOptimizing ? (
          <section className="batch-optimization-progress" aria-live="polite">
            <div className="batch-optimization-progress-heading">
              <span>OPTIMIZANDO</span>
              <strong>{optimization.progress}%</strong>
            </div>
            <div
              className="optimization-progress-track"
              role="progressbar"
              aria-label="Progreso de optimización"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={optimization.progress}
            >
              <span style={{ width: `${optimization.progress}%` }} />
            </div>
            <p>{optimization.phase}</p>
            <button
              type="button"
              className="cancel-operation-button"
              onClick={() => operation.current?.abort()}
            >
              Cancelar
            </button>
          </section>
        ) : null}

        {status && !isExporting ? (
          <p className="batch-status" role="status">
            {status}
          </p>
        ) : null}

        {hasOptimizationResult && !resultNeedsRefresh && report ? (
          <section
            className="batch-result-dashboard is-ready"
            aria-label="Resultado de optimización"
          >
            <div className="batch-result-heading">
              <div>
                <h2>Resultado del batch</h2>
              </div>
            </div>

            {results.length > 0 ? (
              <div className="batch-production-summary">
                <div className="batch-production-summary-list">
                  {results.map((result) => {
                        const placement = summarizeProductionPlacement(
                          prepared?.definitions ?? [],
                          result,
                        );

                        return <section
                          key={result.fabric}
                          className="batch-production-summary-card"
                        >
                          <h3 className="batch-production-summary-fabric">
                            {result.fabric.charAt(0).toUpperCase() +
                              result.fabric.slice(1)}
                          </h3>
                          <div className="batch-metrics">
                            <div><strong>{result.layouts.length}</strong><span>CANVAS</span></div>
                            <div><strong>{formatMeters(result.layouts.reduce((total, layout) => total + layout.usedHeight, 0))} m</strong><span>METROS</span></div>
                            <div><strong>{placement.placedGarments}/{placement.totalGarments}</strong><span>PRENDAS</span></div>
                            {placement.totalReplacements > 0 ? <div><strong>{placement.placedReplacements}/{placement.totalReplacements}</strong><span>REPOSICIONES</span></div> : null}
                            <div><strong>{(result.elapsedMs / 1000).toFixed(2)} s</strong><span>TIEMPO</span></div>
                          </div>
                          <p
                            className={
                              placement.complete
                                ? 'batch-production-summary-ok'
                                : 'batch-production-summary-warning'
                            }
                          >
                            {placement.placedGarments}/{placement.totalGarments}{' '}
                            prendas colocadas
                            {placement.totalReplacements > 0
                              ? ` · ${placement.placedReplacements}/${placement.totalReplacements} reposiciones colocadas`
                              : ''}
                            {placement.totalRequiredPngs > 0
                              ? ` · ${placement.placedRequiredPngs}/${placement.totalRequiredPngs} PNG requeridos colocados`
                              : ''}
                          </p>
                        </section>;
                  })}
                </div>
              </div>
            ) : null}

            {!optimizationReady && report.errors.length > 0 ? (
              <section
                className="batch-preflight-blocked"
                aria-label="Exportación bloqueada"
                role="alert"
              >
                <h3>No se puede preparar la exportación</h3>
                <ul>
                  {report.errors.slice(0, 3).map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
                {report.errors.length > 3 ? (
                  <p>
                    + {report.errors.length - 3}{' '}
                    {report.errors.length - 3 === 1 ? 'error más' : 'errores más'}
                  </p>
                ) : null}
              </section>
            ) : null}

            {optimizationReady ? <div className="batch-export-step">
              <BatchExportPanel
                report={report}
                busy={isOptimizing || isExporting}
                exporting={isExporting}
                exported={exportSucceeded}
                status={isExporting ? status : null}
                onExport={() => void exportPdf()}
                onCancel={() => operation.current?.abort()}
              />
            </div> : null}
          </section>
        ) : null}
      </div>

      {optimizationDiagnostics || exportDiagnostics ? (
        <details className="performance-diagnostics">
          <summary>DIAGNÓSTICO DE RENDIMIENTO</summary>

          {optimizationDiagnostics ? (
            <div className="performance-diagnostics-block">
              <strong>OPTIMIZACIÓN</strong>

              <pre>
                {`Perfil ....................... ${optimizationDiagnostics.profileName} ${optimizationDiagnostics.profileWidthMm}×${optimizationDiagnostics.profileHeightMm} mm
${prepared?.profile.laserCutOutline ? `Espacio libre visible ........ ${prepared.profile.minimumVisibleGapMm} mm\nContorno láser ............... ${prepared.profile.laserCutOutlineWidthMm?.toLocaleString('es-AR')} mm negro\n` : ''}
Preparación colecciones ..... ${optimizationDiagnostics.collectionPreparationMs.toFixed(2)} ms
Construcción definiciones .... ${optimizationDiagnostics.definitionBuildMs.toFixed(2)} ms
Extracción contornos ......... ${optimizationDiagnostics.contourExtractionMs.toFixed(2)} ms
Expansión / agrupación ....... ${optimizationDiagnostics.groupingMs.toFixed(2)} ms

Worker round-trip ............ ${optimizationDiagnostics.nestingRoundTripMs.toFixed(2)} ms
Worker cálculo puro .......... ${optimizationDiagnostics.nestingWorkerMs.toFixed(2)} ms
Worker overhead .............. ${optimizationDiagnostics.nestingOverheadMs.toFixed(2)} ms
Required nesting ............. ${optimizationDiagnostics.requiredMs.toFixed(2)} ms
Fillers ...................... ${optimizationDiagnostics.fillerMs.toFixed(2)} ms

Preflight .................... ${preflightElapsedMs.current.toFixed(2)} ms
Total antes de preflight ..... ${optimizationDiagnostics.totalBeforePreflightMs.toFixed(2)} ms

Definiciones ................. ${optimizationDiagnostics.definitions}
Piezas expandidas ............ ${optimizationDiagnostics.expandedPieces}
Grupos de tela ............... ${optimizationDiagnostics.fabricGroups}

Candidatos probados .......... ${optimizationDiagnostics.candidatePlacementsTested.toLocaleString()}
Cache hits ................... ${optimizationDiagnostics.candidateCacheHits.toLocaleString()}
Polygon transforms ........... ${optimizationDiagnostics.polygonTransforms.toLocaleString()}
Polygon translations ......... ${optimizationDiagnostics.polygonTranslations.toLocaleString()}
Broad-phase checks ........... ${optimizationDiagnostics.broadPhaseChecks.toLocaleString()}
Colisiones exactas ........... ${optimizationDiagnostics.exactPolygonCollisionChecks.toLocaleString()}
Layouts creados .............. ${optimizationDiagnostics.layoutsCreated}`}
              </pre>
              {optimizationDiagnostics.engineProfiles.map(
                ({ fabric, profile }) => (
                  <div key={fabric}>
                    <strong>PERFIL MOTOR — {fabric}</strong>
                    <p>
                      Tiempos de pared. ≈ estimación por muestreo 1/
                      {profile.sampleEvery}; preparación y coordenadas
                      completas.
                    </p>
                    <table>
                      <thead>
                        <tr>
                          <th>Bloque</th>
                          <th>ms</th>
                          <th>Muestras / llamadas</th>
                        </tr>
                      </thead>
                      <tbody>
                        {PROFILE_BLOCKS.map((key) => (
                          <tr key={key}>
                            <td>{PROFILE_LABELS[key]}</td>
                            <td>
                              {profile.timings[key].samples <
                              profile.timings[key].calls
                                ? '≈ '
                                : ''}
                              {profile.timings[key].estimatedMs.toFixed(2)}
                            </td>
                            <td>
                              {profile.timings[key].samples.toLocaleString()} /{' '}
                              {profile.timings[key].calls.toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <pre>{`Total motor: ${profile.totalMs.toFixed(2)} ms
Residual sin clasificar (estimado, con signo): ${profile.unclassifiedMs.toFixed(2)} ms

${Object.entries(profile.counters)
  .map(
    ([key, value]) =>
      `${COUNTER_LABELS[key as keyof NestingProfile['counters']]}: ${value.toLocaleString()}`,
  )
  .join('\n')}`}</pre>
                    <p>
                      Segmentos: contadores exactos, sin reloj por par.
                      polygonsOverlap incluye AABB, matemática exacta,
                      colinealidad y point-in-polygon. El residual incluye
                      control, inserciones, GC y error de muestreo.
                    </p>
                  </div>
                ),
              )}
            </div>
          ) : null}

          {exportDiagnostics ? (
            <div className="performance-diagnostics-block">
              <strong>EXPORTACIÓN</strong>

              <pre>
                {`Preparación + transferencia fuentes ... ${exportDiagnostics.sourcePreparationTransferMs.toFixed(2)} ms
Decode Skia ......................... ${exportDiagnostics.decodeMs.toFixed(2)} ms
Composición Skia .................... ${exportDiagnostics.layouts.reduce((sum, item) => sum + item.compositionMs, 0).toFixed(2)} ms
Conversión BGRA → RGB ............... ${exportDiagnostics.layouts.reduce((sum, item) => sum + item.rgbConvertMs, 0).toFixed(2)} ms
Encode + escritura .................. ${exportDiagnostics.layouts.reduce((sum, item) => sum + item.encodeWriteMs, 0).toFixed(2)} ms
Render nativo total ................. ${exportDiagnostics.layouts.reduce((sum, item) => sum + item.totalMs, 0).toFixed(2)} ms

Strips .............................. ${exportDiagnostics.layouts.reduce((sum, item) => sum + item.strips, 0).toLocaleString()}
Piece draws ......................... ${exportDiagnostics.layouts.reduce((sum, item) => sum + item.pieceDraws, 0).toLocaleString()}
Fuentes subidas ..................... ${exportDiagnostics.sourceUploads}
PNG fuente transferidos ............. ${(exportDiagnostics.sourceBytes / 1024 / 1024).toFixed(2)} MiB
IPC calls ........................... ${exportDiagnostics.ipcCalls}

Sesión frontend total* .............. ${exportDiagnostics.totalMs.toFixed(2)} ms
* Incluye selección de carpeta y coordinación frontend.

${exportDiagnostics.layouts
  .map((item, index) => {
    const rawBytes = item.width * item.height * 3;
    const compressionRatio =
      rawBytes > 0 ? (item.outputBytes / rawBytes) * 100 : 0;

    return [
      `CANVAS ${index + 1} · ${item.name}`,
      `Dimensiones .......................... ${item.width.toLocaleString()} × ${item.height.toLocaleString()} px`,
      `Composición .......................... ${item.compositionMs.toFixed(2)} ms`,
      `Conversión BGRA → RGB ................ ${item.rgbConvertMs.toFixed(2)} ms`,
      `Encode + escritura ................... ${item.encodeWriteMs.toFixed(2)} ms`,
      `Render total ......................... ${item.totalMs.toFixed(2)} ms`,
      `Archivo .............................. ${(item.outputBytes / 1024 / 1024).toFixed(2)} MiB`,
      `RGB bruto ............................ ${(rawBytes / 1024 / 1024).toFixed(2)} MiB`,
      `PNG / RGB bruto ...................... ${compressionRatio.toFixed(2)} %`,
      `Strips ............................... ${item.strips.toLocaleString()}`,
      `Piece draws .......................... ${item.pieceDraws.toLocaleString()}`,
    ].join('\n');
  })
  .join('\n\n')}`}
              </pre>
            </div>
          ) : null}
        </details>
      ) : null}
    </section>
  );
}
