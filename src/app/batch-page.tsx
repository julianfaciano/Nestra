import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PROFILE_BLOCKS,
  type NestingProfile,
  type ProfileBlock,
} from '../geometry/nesting-profiler';
import {
  DEFAULT_IMPRENTA_PROFILE,
  DEFAULT_CALANDRA_PROFILE,
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
import { toggleFill, fillersForInstances, extraCounts, pngPieceSummaries } from '../domain/fill-gaps';
import type { BatchPieceDefinition } from '../domain/production-batch';
import { GARMENT_SIZES, type GarmentSize } from '../domain/size';
import { mm } from '../domain/units';
import { physicalSizeFromSourcePixels } from '../domain/source-image-size';
import { extractLargestAlphaPolygon } from '../geometry/alpha-polygon';
import { type MultiNestingPiece } from '../geometry/multi-piece-nesting-engine';
import { polygonPixelsToMillimeters } from '../geometry/polygon-transform';
import type { Polygon } from '../geometry/polygon';
import type { BatchPieceDraft, FreePngDraft, ProductionPieceDraft } from './batch-state';
import { FreePngPanel } from './free-png-panel';
import { chooseFreePng, validFreePngQuantity } from './free-png-import';
import type { SizeTemplateDraft } from './size-template-state';
import {
  findCollectionAsset,
  findCollectionPreviewAsset,
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

const DEFAULT_ALPHA_THRESHOLD = 16;
const FAST_SIMPLIFICATION_PX = 3;
const FINE_SIMPLIFICATION_PX = 1.5;
const DEFAULT_SCAN_STEP_MM = 22.5;

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
    if (definition.kind === 'free-png') continue;
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
  readonly fastPolygon: Polygon;
  readonly finePolygon: Polygon;
}

async function polygonsFromDefinition(
  definition: BatchPieceDefinition,
  file: File,
): Promise<PolygonPair> {
  let cacheKey: string | undefined;

  try {
    cacheKey = await buildContourCacheKey(file, {
      alphaThreshold: definition.alphaThreshold,
      fastSimplificationPx: FAST_SIMPLIFICATION_PX,
      fineSimplificationPx: FINE_SIMPLIFICATION_PX,
      physicalWidthMm: definition.physicalWidthMm,
      physicalHeightMm: definition.physicalHeightMm,
    });

    const cached = await loadCachedContourPair(cacheKey);

    if (cached) {
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

    const fastPolygon = polygonPixelsToMillimeters(
      fastContour.simplifiedPolygon,
      image.width,
      image.height,
      definition.physicalWidthMm,
      definition.physicalHeightMm,
    );

    const finePolygon = polygonPixelsToMillimeters(
      fineContour.simplifiedPolygon,
      image.width,
      image.height,
      definition.physicalWidthMm,
      definition.physicalHeightMm,
    );

    const result: PolygonPair = {
      fastPolygon,
      finePolygon,
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
  draft: BatchPieceDraft,
  templates: readonly SizeTemplateDraft[],
): SizeTemplateDraft | undefined {
  return templates.find(
    (template) => template.size === draft.size && template.side === draft.side,
  );
}

function validateDraft(draft: ProductionPieceDraft): string | null {
  if (draft.kind === 'garment' && draft.model.trim().length === 0) {
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

interface BatchPageProps {
  readonly templates: readonly SizeTemplateDraft[];
  readonly collections: readonly DesignCollection[];
}

export function BatchPage({ templates, collections }: BatchPageProps) {
  const [pieces, setPieces] = useState<BatchPieceDraft[]>([createEmptyDraft()]);
  const [batchFabric, setBatchFabric] = useState<string>(DEFAULT_PRODUCTION_FABRIC);
  const [freePngs, setFreePngs] = useState<FreePngDraft[]>([]);
  const fillActivationCounter = useRef(0);
  const [freePngQuantity, setFreePngQuantity] = useState(1);
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
  const [mode, setMode] = useState<'imprenta' | 'calandra'>('imprenta');
  const [isExporting, setIsExporting] = useState(false);
  const [exportSucceeded, setExportSucceeded] = useState(false);
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
          }
      : null;

    preflightElapsedMs.current = performance.now() - startedAt;

    return nextReport;
  }, [prepared, templates, usedTemplates]);
  const profile =
    mode === 'imprenta' ? DEFAULT_IMPRENTA_PROFILE : DEFAULT_CALANDRA_PROFILE;
  const optimizationReady =
    prepared !== null &&
    report !== null &&
    report.errors.length === 0 &&
    results.length > 0;
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

  function invalidateFreePngResults(): void {
    operation.current?.abort();
    setResults([]);
    setPrepared(null);
    optimizationRunIdRef.current = null;
    setUsedTemplates(null);
    setExportSucceeded(false);
    if (exportSuccessTimer.current !== null) {
      window.clearTimeout(exportSuccessTimer.current);
      exportSuccessTimer.current = null;
    }
    setOptimizationDiagnostics(null);
    setExportDiagnostics(null);
    setStatus(null);
  }

  async function importFreePng(): Promise<void> {
    setIsImportingPng(true);
    try {
      const piece = await chooseFreePng(freePngQuantity);
      if (!piece) return;
      if (!mounted.current) {
        URL.revokeObjectURL(piece.imageUrl);
        return;
      }
      ownedUrls.current.add(piece.imageUrl);
      invalidateFreePngResults();
      setFreePngs(current => [...current, piece]);
      setFreePngQuantity(1);
    } catch (error) {
      if (mounted.current) setStatus(error instanceof Error ? error.message : 'No se pudo importar el PNG.');
    } finally {
      if (mounted.current) setIsImportingPng(false);
    }
  }

  function updateFreePng(id: string, patch: Partial<Pick<FreePngDraft, 'quantity' | 'fabric'>>): void {
    if (patch.quantity !== undefined && !validFreePngQuantity(patch.quantity)) return;
    invalidateFreePngResults();
    setFreePngs(current => current.map(piece => piece.id === id ? { ...piece, ...patch } : piece));
  }

  function removeFreePng(id: string): void {
    invalidateFreePngResults();
    const piece = freePngs.find(item => item.id === id);
    if (piece) {
      URL.revokeObjectURL(piece.imageUrl);
      ownedUrls.current.delete(piece.imageUrl);
    }
    setFreePngs(current => current.filter(piece => piece.id !== id));
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

    operation.current?.abort();
    setResults([]);
    setPrepared(null);
    optimizationRunIdRef.current = null;
  }

  function updatePiece(id: string, patch: Partial<BatchPieceDraft>): void {
    operation.current?.abort();
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

    setResults([]);
    setPrepared(null);
    optimizationRunIdRef.current = null;
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

    setResults([]);
    setPrepared(null);
    optimizationRunIdRef.current = null;
  }

  function resetCollectionQuantities(): void {
    operation.current?.abort();

    setCollectionQuantities({});
    setResults([]);
    setPrepared(null);
    optimizationRunIdRef.current = null;
    setUsedTemplates(null);
    setOptimizationDiagnostics(null);
    setExportDiagnostics(null);
    setStatus(null);

    preflightElapsedMs.current = 0;
  }

  function duplicatePiece(piece: BatchPieceDraft): void {
    const imageUrl = piece.file ? URL.createObjectURL(piece.file) : undefined;
    if (imageUrl) ownedUrls.current.add(imageUrl);
    setPieces((current) => [
      ...current,
      { ...piece, id: crypto.randomUUID(), imageUrl },
    ]);
    setResults([]);
    setPrepared(null);
    optimizationRunIdRef.current = null;
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
    diagnosticContext?: {
      readonly runStartedAt: number;
      readonly collectionPreparationMs: number;
    },
  ): Promise<void> {
    const runStartedAt = diagnosticContext?.runStartedAt ?? performance.now();
    const allInputPieces: readonly ProductionPieceDraft[] = [...inputPieces, ...freePngs];

    const collectionPreparationMs =
      diagnosticContext?.collectionPreparationMs ?? 0;

    setOptimizationDiagnostics(null);
    setExportDiagnostics(null);
    setStatus(null);
    setResults([]);
    setPrepared(null);
    optimizationRunIdRef.current = null;

    for (const piece of allInputPieces) {
      const error = validateDraft(piece);

      if (error) {
        setStatus(error);
        return;
      }
    }

    if (allInputPieces.reduce((n, p) => n + p.quantity, 0) > 1000) {
      setStatus('Máximo 1000 piezas por batch en esta versión.');
      return;
    }
    setIsOptimizing(true);
    const controller = new AbortController();
    operation.current = controller;

    try {
      const definitionsStartedAt = performance.now();
      const definitions: BatchPieceDefinition[] = allInputPieces.map((piece) => {
        if (
          !piece.file ||
          !piece.imageUrl ||
          !piece.sourceWidthPx ||
          !piece.sourceHeightPx
        ) {
          throw new Error('El batch contiene una pieza incompleta.');
        }

        const template = piece.kind === 'garment' ? findTemplateForDraft(piece, templates) : undefined;

        const physicalSize = physicalSizeFromSourcePixels(
          piece.sourceWidthPx,
          piece.sourceHeightPx,
        );

        return {
          ...(piece.kind === 'garment'
            ? { kind: 'garment' as const, model: piece.model.trim(), size: piece.size, side: piece.side }
            : { kind: 'free-png' as const, ...(piece.fill ? { fill: piece.fill } : {}) }),
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
      });
      const definitionBuildMs = performance.now() - definitionsStartedAt;
      const contoursStartedAt = performance.now();
      const polygonByDefinitionId = new Map<string, Polygon>();
      const finePolygonByDefinitionId = new Map<string, Polygon>();

      const sourceFileByDefinitionId = new Map<string, File>();

      for (const piece of allInputPieces) {
        if (!piece.file) {
          throw new Error(
            `Falta el archivo fuente de la pieza ${piece.id}.`,
          );
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

        const { fastPolygon, finePolygon } = await polygonsFromDefinition(
          definition,
          file,
        );

        polygonByDefinitionId.set(definition.id, fastPolygon);

        finePolygonByDefinitionId.set(definition.id, finePolygon);
      }
      const contourExtractionMs = performance.now() - contoursStartedAt;
      const groupingStartedAt = performance.now();
      const instances = expandPieceDefinitions(definitions);
      const fabricGroups = groupPiecesByFabric(instances);
      const groupingMs = performance.now() - groupingStartedAt;

      const nextResults: FabricBatchResult[] = [];
      const engineProfiles: { fabric: string; profile: NestingProfile }[] = [];
      let nestingRoundTripMs = 0;
      let nestingWorkerMs = 0;
      let nestingOverheadMs = 0;

      let candidatePlacementsTested = 0;
      let polygonTransforms = 0;
      let polygonTranslations = 0;
      let broadPhaseChecks = 0;
      let exactPolygonCollisionChecks = 0;
      let layoutsCreated = 0;
      let candidateCacheHits = 0;

      for (const group of fabricGroups) {
        const fillers = fillersForInstances(group.pieces);
        const nestingPieces: MultiNestingPiece[] = group.pieces.map(
          (instance: PieceInstance) => {
            const polygon = polygonByDefinitionId.get(instance.definitionId);
            const finePolygon = finePolygonByDefinitionId.get(
              instance.definitionId,
            );

            if (!polygon || !finePolygon) {
              throw new Error(`No se encontró la geometría de ${instance.id}.`);
            }

            return {
              ...(fillers.length ? { artworkSize: {
                width: instance.definition.physicalWidthMm, height: instance.definition.physicalHeightMm,
              } } : {}),
              id: instance.id,
              kind: instance.definition.kind,
              polygon,
              finePolygon,
              allowedRotations: getAllowedRotationsForPiece(instance.definition),
            };
          },
        );

        let workerTiming: NestingWorkerTiming | undefined;

        const startedAt = performance.now();

        const result = await nestInWorker(
          {
            pieces: nestingPieces,
            ...(fillers.length ? { fillers } : {}),
            canvas: {
              width: profile.maxWidth,
              height: profile.maxHeight,
            },
            scanStepMm: DEFAULT_SCAN_STEP_MM,
          },
          controller.signal,
          (timing) => {
            workerTiming = timing;
          },
        );

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
      const nextPrepared: PreparedBatch = {
        definitions,
        polygons: polygonByDefinitionId,
        results: nextResults,
        profile,
      };

      optimizationRunIdRef.current = crypto.randomUUID();

      setPrepared(nextPrepared);
      setUsedTemplates(templates);
      setResults(nextResults);
      setStatus(null);
      setOptimizationDiagnostics({
        engineProfiles,
        collectionPreparationMs,
        definitionBuildMs,
        contourExtractionMs,
        groupingMs,

        nestingRoundTripMs,
        nestingWorkerMs,
        nestingOverheadMs,

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
      setStatus(
        error instanceof Error
          ? error.message
          : 'Ocurrió un error al optimizar el batch.',
      );
    } finally {
      setIsOptimizing(false);
    }
  }

  async function optimizeCollections(): Promise<void> {
    const runStartedAt = performance.now();

    setOptimizationDiagnostics(null);
    setExportDiagnostics(null);
    const fabric = batchFabric.trim();

    if (!fabric) {
      setStatus('Elegí un tipo de tela para el batch.');
      return;
    }

    const generatedPieces: BatchPieceDraft[] = [];

    try {
      for (const collection of collections) {
        for (const size of GARMENT_SIZES) {
          const quantity = collectionQuantities[collection.id]?.[size] ?? 0;

          if (quantity <= 0) {
            continue;
          }

          if (!Number.isSafeInteger(quantity)) {
            throw new Error(`Cantidad inválida en ${collection.name} ${size}.`);
          }

          for (const side of PIECE_SIDES) {
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

      if (generatedPieces.length === 0 && freePngs.length === 0) {
        setStatus('Ingresá al menos una cantidad mayor que cero.');
        return;
      }

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

      await optimizeBatch(generatedPieces, {
        runStartedAt,
        collectionPreparationMs,
      });
    } catch (error) {
      for (const piece of generatedPieces) {
        if (piece.imageUrl) {
          URL.revokeObjectURL(piece.imageUrl);
          ownedUrls.current.delete(piece.imageUrl);
        }
      }

      setStatus(
        error instanceof Error
          ? error.message
          : 'No se pudo preparar el batch.',
      );
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
              meters: result.layouts.reduce(
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
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsExporting(false);

      if (operation.current === controller) {
        operation.current = null;
      }
    }
  }

  return (
    <section className="batch-page">
      <fieldset
        disabled={isOptimizing || isExporting || isImportingPng}
        style={{ border: 0, padding: 0, margin: 0 }}
      >
        <div className="page-header">
          <div>
            <h1>Producción</h1>
            <p className="muted">
              Elegí los diseños importados y la cantidad de prendas de cada
              talle.
            </p>
          </div>
        </div>

        <div className="segmented-toggle" aria-label="Perfil de salida">
          {(['imprenta', 'calandra'] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={mode === option ? 'selected' : ''}
              onClick={() => {
                if (option === mode) {
                  return;
                }

                operation.current?.abort();

                if (exportSuccessTimer.current !== null) {
                  window.clearTimeout(exportSuccessTimer.current);
                }

                setMode(option);
                setResults([]);
                setPrepared(null);
                optimizationRunIdRef.current = null;
                setUsedTemplates(null);
                setOptimizationDiagnostics(null);
                setExportDiagnostics(null);
                setStatus(null);

                preflightElapsedMs.current = 0;
              }}
            >
              {option === 'imprenta' ? 'IMPRENTA' : 'CALANDRA'}
            </button>
          ))}
        </div>
        <div className="collection-batch-settings">
          <label className="field">
            <span>Tipo de tela para todo el batch</span>
            <input
              type="text"
              value={batchFabric}
              placeholder="deportiva"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="none"
              onChange={(event) => {
                setBatchFabric(event.target.value);
                setResults([]);
                setPrepared(null);
                optimizationRunIdRef.current = null;
              }}
            />
          </label>
        </div>

        <section className="collection-batch-browser">
          <div className="collection-browser-heading">
            {collections.length > 0 ? (
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

          {collections.length === 0 ? (
            <p className="helper-text">
              No hay diseños importados. Agregalos primero desde la Biblioteca
              de siluetas.
            </p>
          ) : (
            <div className="collection-batch-grid">
              {[...collections]
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
        </section>
        <p>
          {collections.reduce(
            (total, collection) =>
              total +
              GARMENT_SIZES.reduce(
                (subtotal, size) =>
                  subtotal + (collectionQuantities[collection.id]?.[size] ?? 0),
                0,
              ),
            0,
          )}{' '}
          prendas seleccionadas · cada prenda genera automáticamente un frente y
          un dorso.
        </p>
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

        <FreePngPanel pieces={freePngs} quantity={freePngQuantity}
          onQuantity={setFreePngQuantity} onImport={() => void importFreePng()}
          onUpdate={updateFreePng} onRemove={removeFreePng}
          onToggleFill={toggleFreePngFill} extras={optimizationReady ? extraCounts(results) : undefined} />

        <div className="batch-production-flow">
          <div className="batch-actions">
            <button
              className={[
                'batch-primary-button',
                isOptimizing ? 'is-loading' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              type="button"
              disabled={isOptimizing}
              onClick={() => void optimizeCollections()}
            >
              {isOptimizing ? 'OPTIMIZANDO...' : 'OPTIMIZAR BATCH'}
            </button>
          </div>
        </div>
      </fieldset>

      <div className="batch-production-flow batch-production-flow-after">
        {isOptimizing ? (
          <button
            type="button"
            className="cancel-operation-button"
            onClick={() => operation.current?.abort()}
          >
            CANCELAR OPERACIÓN
          </button>
        ) : null}

        {status && !isExporting ? (
          <p className="batch-status" role="status">
            {status}
          </p>
        ) : null}

        {optimizationReady && report ? (
          <>
            <div className="batch-flow-arrow" aria-hidden="true">
              ↓
            </div>

            <p className="batch-flow-message">BATCH OPTIMIZADO CORRECTAMENTE</p>

            <div className="batch-flow-arrow" aria-hidden="true">
              ↓
            </div>

            {results.length > 0 ? (
              <div className="batch-production-summary">
                <div className="batch-production-summary-list">
                  {results.map((result) => (
                    <section
                      key={result.fabric}
                      className="batch-production-summary-card"
                    >
                      <p className="batch-production-summary-fabric">
                        {result.fabric.charAt(0).toUpperCase() +
                          result.fabric.slice(1)}
                      </p>

                      <p className="batch-production-summary-metrics">
                        {result.layouts.length} canvas ·{' '}
                        {formatMeters(
                          result.layouts.reduce(
                            (total, layout) => total + layout.usedHeight,
                            0,
                          ),
                        )}{' '}
                        metros · {(result.elapsedMs / 1000).toFixed(2)} s
                      </p>

                      {result.unplacedPieceIds.length > 0 ? (
                        <p className="batch-production-summary-warning">
                          {result.unplacedPieceIds.length} piezas sin
                          colocar
                        </p>
                      ) : (
                        <p className="batch-production-summary-ok">
                          Todas las piezas colocadas
                        </p>
                      )}
                    </section>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="batch-flow-arrow" aria-hidden="true">
              ↓
            </div>

            <div className="batch-export-step">
              <BatchExportPanel
                report={report}
                busy={isOptimizing || isExporting}
                exporting={isExporting}
                exported={exportSucceeded}
                status={isExporting ? status : null}
                onExport={() => void exportPdf()}
                onCancel={() => operation.current?.abort()}
              />
            </div>
          </>
        ) : null}
      </div>

      {optimizationDiagnostics || exportDiagnostics ? (
        <details className="performance-diagnostics" open>
          <summary>DIAGNÓSTICO DE RENDIMIENTO</summary>

          {optimizationDiagnostics ? (
            <div className="performance-diagnostics-block">
              <strong>OPTIMIZACIÓN</strong>

              <pre>
                {`Preparación colecciones ..... ${optimizationDiagnostics.collectionPreparationMs.toFixed(2)} ms
Construcción definiciones .... ${optimizationDiagnostics.definitionBuildMs.toFixed(2)} ms
Extracción contornos ......... ${optimizationDiagnostics.contourExtractionMs.toFixed(2)} ms
Expansión / agrupación ....... ${optimizationDiagnostics.groupingMs.toFixed(2)} ms

Worker round-trip ............ ${optimizationDiagnostics.nestingRoundTripMs.toFixed(2)} ms
Worker cálculo puro .......... ${optimizationDiagnostics.nestingWorkerMs.toFixed(2)} ms
Worker overhead .............. ${optimizationDiagnostics.nestingOverheadMs.toFixed(2)} ms

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
