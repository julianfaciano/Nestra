import type { PngPieceSummary } from '../domain/fill-gaps';

export interface HistoricalFile {
  readonly name: string;
  readonly path: string;
  readonly size: number;
  readonly type: string;

  readonly widthPx?: number;
  readonly heightPx?: number;

  readonly dpiX?: number;
  readonly dpiY?: number;

  readonly physicalWidthCm?: number;
  readonly physicalHeightCm?: number;

  readonly thumbnailKey?: string;
}

export interface HistoricalMeters {
  readonly deportiva: number;
  readonly polar: number;
  readonly unclassified: number;
}

export interface HistoricalSizeSummary {
  readonly model: string;
  readonly fabric?: string;

  readonly sizes: readonly {
    readonly size: string;
    readonly quantity: number;
  }[];
}

export interface HistoricalJob {
  readonly freePngPieces?: readonly PngPieceSummary[];
  readonly extraPieces?: readonly PngPieceSummary[];
  readonly id: string;
  readonly jobNumber: number;
  readonly name: string;
  readonly sourceFolderPath: string;

  readonly createdAt: number;
  readonly canvasCount: number;
  readonly meters: HistoricalMeters;
  readonly sizeSummary?: readonly HistoricalSizeSummary[];

  readonly files: readonly HistoricalFile[];
  readonly importedHistorical: boolean;
  readonly optimizationRunId?: string;
  /** Present only on the in-memory card produced by session grouping. */
  readonly sessionJobIds?: readonly string[];
}

export interface NativeHistoricalJob {
  readonly name: string;
  readonly path: string;
  readonly files: readonly HistoricalFile[];
}

export interface OptimizedHistoricalBatch {
  readonly freePngPieces?: readonly PngPieceSummary[];
  readonly extraPieces?: readonly PngPieceSummary[];
  readonly createdAt?: number;
  readonly optimizationRunId?: string;
  readonly canvasCount: number;
  readonly files?: readonly HistoricalFile[];

readonly sizeSummary?: readonly HistoricalSizeSummary[];
  readonly fabrics: readonly {
    readonly fabric: string;
    readonly meters: number;
  }[];
}

const KEY = 'nestra.historical-jobs';

const MONTHS = [
  'Ene',
  'Feb',
  'Mar',
  'Abr',
  'May',
  'Jun',
  'Jul',
  'Ago',
  'Sep',
  'Oct',
  'Nov',
  'Dic',
] as const;

const MONTH_INDEX: Readonly<Record<string, number>> = {
  ene: 0,
  jan: 0,
  feb: 1,
  mar: 2,
  abr: 3,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  ago: 7,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dic: 11,
  dec: 11,
};

interface RawHistoricalFile {
  readonly name?: unknown;
  readonly path?: unknown;
  readonly size?: unknown;
  readonly type?: unknown;
  readonly fileType?: unknown;

  readonly widthPx?: unknown;
  readonly heightPx?: unknown;

  readonly dpiX?: unknown;
  readonly dpiY?: unknown;

  readonly physicalWidthCm?: unknown;
  readonly physicalHeightCm?: unknown;

  readonly thumbnailKey?: unknown;
}

interface RawHistoricalJob {
  readonly freePngPieces?: unknown;
  readonly extraPieces?: unknown;
  readonly id?: unknown;
  readonly jobNumber?: unknown;
  readonly name?: unknown;
  readonly sourceFolderPath?: unknown;

  readonly dateText?: unknown;
  readonly createdAt?: unknown;
  readonly canvasCount?: unknown;
  readonly meters?: unknown;

  readonly files?: unknown;
  readonly importedHistorical?: unknown;
  readonly optimizationRunId?: unknown;
  readonly sizeSummary?: unknown;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function normalizeMonth(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function timestampFromParts(
  day: number,
  month: number,
  year: number,
): number | undefined {
  if (
    !Number.isInteger(day) ||
    !Number.isInteger(month) ||
    !Number.isInteger(year) ||
    day < 1 ||
    day > 31 ||
    month < 0 ||
    month > 11
  ) {
    return undefined;
  }

  const fullYear = year < 100 ? 2000 + year : year;

  /*
   * Mediodía UTC evita que una fecha puramente calendaria
   * retroceda un día al mostrarse en Argentina.
   */
  return Date.UTC(fullYear, month, day, 12, 0, 0);
}

export function historicalTimestampFromText(
  value: string,
): number | undefined {
  const named = value.match(
    /(\d{1,2})-([A-Za-zÁÉÍÓÚáéíóú]{3})-(\d{2,4})/,
  );

  if (named) {
  const monthText = named[2];

  if (!monthText) {
    return undefined;
  }

  const month = MONTH_INDEX[normalizeMonth(monthText)];

  if (month !== undefined) {
    return timestampFromParts(
      Number(named[1]),
      month,
      Number(named[3]),
    );
  }
}

  /*
   * Compatibilidad con los primeros batches de Nestra:
   * "Batch 6/9/2026, 02:36:50"
   */
  const numeric = value.match(
    /(\d{1,2})\/(\d{1,2})\/(\d{4})/,
  );

  if (numeric) {
    return timestampFromParts(
      Number(numeric[1]),
      Number(numeric[2]) - 1,
      Number(numeric[3]),
    );
  }

  return undefined;
}

export function formatHistoricalDate(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return 'Sin fecha';
  }

  const date = new Date(timestamp);

  const day = String(date.getDate()).padStart(2, '0');
  const month = MONTHS[date.getMonth()];
  const year = String(date.getFullYear()).slice(-2);

  return `${day}/${month}/${year}`;
}

export function formatHistoricalFolderDate(
  timestamp: number,
): string {
  const date = new Date(timestamp);

  if (!Number.isFinite(date.getTime())) {
    return 'Sin-fecha';
  }

  const day = String(
    date.getDate(),
  ).padStart(2, '0');

  const month =
    MONTHS[date.getMonth()] ?? '---';

  const year = String(
    date.getFullYear(),
  ).slice(-2);

  return `${day}-${month}-${year}`;
}

export function historicalJobNumberFromName(
  name: string,
): number | undefined {
  const match = name.match(
    /^\s*(\d+)\s*(?:\(|$)/,
  );

  if (!match?.[1]) {
    return undefined;
  }

  const value = Number(match[1]);

  return Number.isSafeInteger(value) &&
    value > 0
    ? value
    : undefined;
}

function assignMissingHistoricalJobNumbers(
  jobs: readonly HistoricalJob[],
): HistoricalJob[] {
  /*
   * El número visible es un índice continuo
   * del Historial, no un ID persistente.
   *
   * Ordenamos del trabajo más antiguo al más
   * nuevo y reasignamos 1, 2, 3... cada vez
   * que se carga, guarda, importa o elimina.
   */
  const ordered = [...jobs].sort(
    (left, right) => {
      const dateDifference =
        left.createdAt -
        right.createdAt;

      if (dateDifference !== 0) {
        return dateDifference;
      }

      /*
       * Conserva un orden estable cuando
       * dos registros tienen exactamente
       * la misma fecha.
       */
      const numberDifference =
        left.jobNumber -
        right.jobNumber;

      if (numberDifference !== 0) {
        return numberDifference;
      }

      return left.name.localeCompare(
        right.name,
        'es',
        {
          numeric: true,
          sensitivity: 'base',
        },
      );
    },
  );

  const numberById = new Map<
    string,
    number
  >();

  ordered.forEach(
    (job, index) => {
      numberById.set(
        job.id,
        index + 1,
      );
    },
  );

  return jobs.map((job) => ({
    ...job,
    jobNumber:
      numberById.get(job.id) ?? 0,
  }));
}

export function historicalCopiesFromName(name: string): number {
  const match = name.match(/\b(\d+)\s+copias?\b/i);

  if (!match) {
    return 1;
  }

  const copies = Number(match[1]);

  return Number.isSafeInteger(copies) && copies > 0
    ? copies
    : 1;
}

export function historicalFabricFromName(
  name: string,
): 'deportiva' | 'polar' | undefined {
  const normalized = name
    .normalize('NFD')
    .replace(
      /[\u0300-\u036f]/g,
      '',
    )
    .toUpperCase();

  /*
   * Primero usamos los nombres explícitos
   * que ya existen en los pedidos nuevos.
   */
  if (
    /\bDEPORTIVA\b/.test(
      normalized,
    ) ||
    /\bTELA\s+DEP(?:ORTIVA)?\b/.test(
      normalized,
    )
  ) {
    return 'deportiva';
  }

  if (
    /\bPOLAR\b/.test(
      normalized,
    ) ||
    /\bTELA\s+POL(?:AR)?\b/.test(
      normalized,
    )
  ) {
    return 'polar';
  }

  /*
   * Si el nombre es solamente algo como
   * "1 copia.jpg", no hay información
   * suficiente para inventar la tela.
   */
  return undefined;
}

export function historicalMetricsFromFiles(
  files: readonly HistoricalFile[],
): {
  readonly canvasCount: number;
  readonly meters: HistoricalMeters;
} {
  let canvasCount = 0;
  let deportiva = 0;
  let polar = 0;
  let unclassified = 0;

  for (const file of files) {
    const copies = historicalCopiesFromName(file.name);
    canvasCount += copies;

    if (
      file.physicalHeightCm === undefined ||
      !Number.isFinite(file.physicalHeightCm) ||
      file.physicalHeightCm <= 0
    ) {
      continue;
    }

    const meters =
      (file.physicalHeightCm / 100) * copies;

    switch (historicalFabricFromName(file.name)) {
      case 'deportiva':
        deportiva += meters;
        break;

      case 'polar':
        polar += meters;
        break;

      default:
        unclassified += meters;
        break;
    }
  }

  return {
    canvasCount,
    meters: {
      deportiva,
      polar,
      unclassified,
    },
  };
}

function normalizeHistoricalFile(
  value: unknown,
): HistoricalFile | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const raw = value as RawHistoricalFile;

  if (
    typeof raw.name !== 'string' ||
    typeof raw.path !== 'string' ||
    typeof raw.size !== 'number' ||
    !Number.isFinite(raw.size)
  ) {
    return null;
  }

  const type =
    typeof raw.type === 'string'
      ? raw.type
      : typeof raw.fileType === 'string'
        ? raw.fileType
        : null;

  if (!type) {
    return null;
  }

  const widthPx = finiteNumber(raw.widthPx);
  const heightPx = finiteNumber(raw.heightPx);
  const dpiX = finiteNumber(raw.dpiX);
  const dpiY = finiteNumber(raw.dpiY);
  const physicalWidthCm = finiteNumber(raw.physicalWidthCm);
  const physicalHeightCm = finiteNumber(raw.physicalHeightCm);

  return {
    name: raw.name,
    path: raw.path,
    size: raw.size,
    type,

    ...(widthPx !== undefined ? { widthPx } : {}),
    ...(heightPx !== undefined ? { heightPx } : {}),

    ...(dpiX !== undefined ? { dpiX } : {}),
    ...(dpiY !== undefined ? { dpiY } : {}),

    ...(physicalWidthCm !== undefined
      ? { physicalWidthCm }
      : {}),

    ...(physicalHeightCm !== undefined
      ? { physicalHeightCm }
      : {}),

    ...(typeof raw.thumbnailKey === 'string'
      ? { thumbnailKey: raw.thumbnailKey }
      : {}),
  };
}

function normalizeMeters(
  value: unknown,
): HistoricalMeters | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const raw = value as Record<string, unknown>;

  const deportiva = finiteNumber(raw.deportiva);
  const polar = finiteNumber(raw.polar);
  const unclassified = finiteNumber(raw.unclassified);

  if (
    deportiva === undefined ||
    polar === undefined ||
    unclassified === undefined
  ) {
    return undefined;
  }

  return {
    deportiva,
    polar,
    unclassified,
  };
}

function normalizeSizeSummary(
  value: unknown,
): HistoricalSizeSummary[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const result: HistoricalSizeSummary[] = [];

  for (const entry of value) {
    if (
      !entry ||
      typeof entry !== 'object'
    ) {
      continue;
    }

    const raw = entry as {
      readonly model?: unknown;
      readonly fabric?: unknown;
      readonly sizes?: unknown;
    };

    if (
      typeof raw.model !== 'string' ||
      !Array.isArray(raw.sizes)
    ) {
      continue;
    }

    const sizes: {
      size: string;
      quantity: number;
    }[] = [];

    for (const sizeEntry of raw.sizes) {
      if (
        !sizeEntry ||
        typeof sizeEntry !== 'object'
      ) {
        continue;
      }

      const rawSize =
        sizeEntry as {
          readonly size?: unknown;
          readonly quantity?: unknown;
        };

      if (
        typeof rawSize.size !== 'string' ||
        typeof rawSize.quantity !==
          'number' ||
        !Number.isFinite(
          rawSize.quantity,
        ) ||
        rawSize.quantity <= 0
      ) {
        continue;
      }

      sizes.push({
        size: rawSize.size,

        quantity: Math.round(
          rawSize.quantity,
        ),
      });
    }

    if (sizes.length > 0) {
      result.push({
        model: raw.model,
        ...(typeof raw.fabric === 'string' ? { fabric: raw.fabric } : {}),
        sizes,
      });
    }
  }

  return result.length > 0
    ? result
    : undefined;
}

function normalizePngPieces(value: unknown): PngPieceSummary[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const grouped = new Map<string, PngPieceSummary>();
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    if (typeof raw.name !== 'string' || !raw.name.trim() || typeof raw.fabric !== 'string' ||
        !raw.fabric.trim() || typeof raw.count !== 'number' || !Number.isSafeInteger(raw.count) || raw.count <= 0) continue;
    const key = JSON.stringify([raw.name, raw.fabric]);
    const count = (grouped.get(key)?.count ?? 0) + raw.count;
    if (Number.isSafeInteger(count)) grouped.set(key, { name: raw.name, fabric: raw.fabric, count });
  }
  return grouped.size ? [...grouped.values()] : undefined;
}

function normalizeHistoricalJob(
  value: unknown,
): HistoricalJob | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const raw = value as RawHistoricalJob;

  if (
    typeof raw.id !== 'string' ||
    typeof raw.name !== 'string' ||
    typeof raw.sourceFolderPath !== 'string' ||
    !Array.isArray(raw.files)
  ) {
    return null;
  }

  const files = raw.files
    .map(normalizeHistoricalFile)
    .filter(
      (file): file is HistoricalFile =>
        file !== null,
    );

  const derived = historicalMetricsFromFiles(files);

  const importedHistorical =
    raw.importedHistorical === true ||
    raw.sourceFolderPath.length > 0;

  const createdAt =
    finiteNumber(raw.createdAt) ??
    historicalTimestampFromText(raw.name) ??
    (typeof raw.dateText === 'string'
      ? historicalTimestampFromText(raw.dateText)
      : undefined) ??
    0;

  const canvasCount = importedHistorical
    ? derived.canvasCount
    : finiteNumber(raw.canvasCount) ??
      derived.canvasCount;

  const meters = importedHistorical
    ? derived.meters
    : normalizeMeters(raw.meters) ??
      derived.meters;

  const sizeSummary =
    normalizeSizeSummary(raw.sizeSummary);
  const freePngPieces = normalizePngPieces(raw.freePngPieces);
  const extraPieces = normalizePngPieces(raw.extraPieces);

  const jobNumber =
    finiteNumber(raw.jobNumber) ??
    historicalJobNumberFromName(raw.name) ??
    0;

  return {
    id: raw.id,
    ...(typeof raw.optimizationRunId === 'string'
      ? { optimizationRunId: raw.optimizationRunId }
      : {}),
    ...(freePngPieces ? { freePngPieces } : {}),
    ...(extraPieces ? { extraPieces } : {}),

    jobNumber: Math.max(
      0,
      Math.round(jobNumber),
    ),

    name: raw.name,
    sourceFolderPath: raw.sourceFolderPath,
    createdAt,

    canvasCount: Math.max(
      0,
      Math.round(canvasCount),
    ),

    meters,

    ...(sizeSummary
      ? { sizeSummary }
      : {}),

    files,
    importedHistorical,
  };
}


export function normalizeHistoricalPath(path: string): string {
  return path
    .replace(/[\\/]+$/, '')
    .toLowerCase();
}

export function sortHistoricalJobs(
  jobs: readonly HistoricalJob[],
): HistoricalJob[] {
  return [...jobs].sort((a, b) => {
    const dateDifference =
      b.createdAt - a.createdAt;
      if (
  b.jobNumber !==
  a.jobNumber
) {
  return (
    b.jobNumber -
    a.jobNumber
  );
}

    if (dateDifference !== 0) {
      return dateDifference;
    }

    return b.name.localeCompare(
      a.name,
      'es',
      {
        numeric: true,
        sensitivity: 'base',
      },
    );
  });
}

const LOCAL_SESSION_MAX_GAP_MS = 10 * 60 * 1000;

function localDayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function mergeHistoricalSizes(
  jobs: readonly HistoricalJob[],
): readonly HistoricalSizeSummary[] | undefined {
  const byKey = new Map<string, { model: string; fabric?: string; sizes: Map<string, number> }>();
  for (const job of jobs) {
    for (const entry of job.sizeSummary ?? []) {
      const key = `${entry.model}\u0000${entry.fabric ?? ''}`;
      const current = byKey.get(key) ?? {
        model: entry.model,
        ...(entry.fabric ? { fabric: entry.fabric } : {}),
        sizes: new Map<string, number>(),
      };
      for (const size of entry.sizes) {
        current.sizes.set(size.size, (current.sizes.get(size.size) ?? 0) + size.quantity);
      }
      byKey.set(key, current);
    }
  }
  const result = [...byKey.values()].map((entry) => ({
    model: entry.model,
    ...(entry.fabric ? { fabric: entry.fabric } : {}),
    sizes: [...entry.sizes.entries()].map(([size, quantity]) => ({ size, quantity })),
  }));
  return result.length ? result : undefined;
}

function mergePngSummaries(
  jobs: readonly HistoricalJob[],
  field: 'freePngPieces' | 'extraPieces',
): readonly PngPieceSummary[] | undefined {
  const grouped = new Map<string, PngPieceSummary>();
  for (const job of jobs) {
    for (const piece of job[field] ?? []) {
      const key = `${piece.name}\u0000${piece.fabric}`;
      const previous = grouped.get(key);
      grouped.set(key, previous
        ? { ...previous, count: previous.count + piece.count }
        : { ...piece });
    }
  }
  return grouped.size ? [...grouped.values()] : undefined;
}

function mergeLocalSession(jobs: readonly HistoricalJob[]): HistoricalJob {
  const first = jobs[0]!;
  const files = jobs.flatMap((job) => job.files);
  const meters = jobs.reduce(
    (total, job) => ({
      deportiva: total.deportiva + job.meters.deportiva,
      polar: total.polar + job.meters.polar,
      unclassified: total.unclassified + job.meters.unclassified,
    }),
    { deportiva: 0, polar: 0, unclassified: 0 },
  );
  const sizeSummary = mergeHistoricalSizes(jobs);
  const freePngPieces = mergePngSummaries(jobs, 'freePngPieces');
  const extraPieces = mergePngSummaries(jobs, 'extraPieces');
  return {
    id: `session:${first.id}`,
    jobNumber: first.jobNumber,
    name: first.name,
    sourceFolderPath: '',
    createdAt: first.createdAt,
    importedHistorical: false,
    sessionJobIds: jobs.map((job) => job.id),
    canvasCount: jobs.reduce((total, job) => total + job.canvasCount, 0),
    meters,
    files,
    ...(sizeSummary ? { sizeSummary } : {}),
    ...(freePngPieces ? { freePngPieces } : {}),
    ...(extraPieces ? { extraPieces } : {}),
  };
}

export function groupHistoricalJobs(
  jobs: readonly HistoricalJob[],
): HistoricalJob[] {
  const ordered = [...jobs].sort((a, b) => a.createdAt - b.createdAt);
  const cards: HistoricalJob[] = [];
  let localSession: HistoricalJob[] = [];
  let previousLocalTimestamp = 0;
  let sessionDay = '';

  const flush = () => {
    if (localSession.length) cards.push(localSession.length > 1 ? mergeLocalSession(localSession) : localSession[0]!);
    localSession = [];
  };

  for (const job of ordered) {
    if (job.importedHistorical || job.sourceFolderPath) {
      cards.push(job);
      continue;
    }
    const day = localDayKey(job.createdAt);
    if (!localSession.length || day !== sessionDay || job.createdAt - previousLocalTimestamp > LOCAL_SESSION_MAX_GAP_MS) {
      flush();
      sessionDay = day;
    }
    localSession.push(job);
    previousLocalTimestamp = job.createdAt;
  }
  flush();
  return sortHistoricalJobs(assignMissingHistoricalJobNumbers(cards));
}

export function mergeHistoricalJobs(
  current: readonly HistoricalJob[],
  incoming: readonly HistoricalJob[],
): HistoricalJob[] {
  /*
   * Los batches creados por Nestra no tienen sourceFolderPath.
   * NO deben deduplicarse entre sí.
   */
  const localJobs = current.filter(
    (job) => !job.sourceFolderPath,
  );

  const importedByPath = new Map(
    current
      .filter((job) => job.sourceFolderPath)
      .map((job) => [
        normalizeHistoricalPath(job.sourceFolderPath),
        job,
      ]),
  );

  for (const job of incoming) {
    const key = normalizeHistoricalPath(
      job.sourceFolderPath,
    );

    const previous = importedByPath.get(key);

    importedByPath.set(
      key,
      previous
        ? {
            ...job,
            id: previous.id,
          }
        : job,
    );
  }

  return sortHistoricalJobs(
  assignMissingHistoricalJobNumbers([
    ...localJobs,
    ...importedByPath.values(),
  ]),
);
}

export function buildImportedHistoricalJob(
  job: NativeHistoricalJob,
): HistoricalJob {
  const metrics =
    historicalMetricsFromFiles(job.files);

  return {
    id: crypto.randomUUID(),
    jobNumber:
  historicalJobNumberFromName(
    job.name,
  ) ?? 0,
    name: job.name,
    sourceFolderPath: job.path,
    createdAt:
      historicalTimestampFromText(job.name) ?? 0,
    canvasCount: metrics.canvasCount,
    meters: metrics.meters,
    files: job.files,
    importedHistorical: true,
  };
}

export function loadHistoricalJobs(): HistoricalJob[] {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(KEY) ?? '[]',
    );

    if (!Array.isArray(parsed)) {
      return [];
    }

    const jobs =
  sortHistoricalJobs(
    assignMissingHistoricalJobNumbers(
      parsed
        .map(
          normalizeHistoricalJob,
        )
        .filter(
          (
            job,
          ): job is HistoricalJob =>
            job !== null,
        ),
    ),
  );

    /*
     * Migra automáticamente versiones anteriores.
     * Si falla el guardado, igual devolvemos los datos sanos.
     */
    try {
      saveHistoricalJobs(jobs);
    } catch {
      // La lectura sigue siendo válida.
    }

    return jobs;
  } catch {
    return [];
  }
}

export function saveHistoricalJobs(
  jobs: readonly HistoricalJob[],
): void {
  localStorage.setItem(
    KEY,
    JSON.stringify(
      sortHistoricalJobs(
        assignMissingHistoricalJobNumbers(
          jobs,
        ),
      ),
    ),
  );
}


function classifyProductionFabric(
  fabric: string,
): keyof HistoricalMeters {
  const normalized = fabric
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (normalized.includes('deportiva')) {
    return 'deportiva';
  }

  if (normalized.includes('polar')) {
    return 'polar';
  }

  return 'unclassified';
}

export function recordOptimizedBatch(
  batch: OptimizedHistoricalBatch,
): void {
  const meters: HistoricalMeters = {
    deportiva: 0,
    polar: 0,
    unclassified: 0,
  };

  const mutableMeters = {
    ...meters,
  };

  for (const item of batch.fabrics) {
    const key =
      classifyProductionFabric(item.fabric);

    mutableMeters[key] += Math.max(
      0,
      item.meters,
    );
  }

  const createdAt =
    batch.createdAt ?? Date.now();

  const freePngPieces = normalizePngPieces(batch.freePngPieces);
  const extraPieces = normalizePngPieces(batch.extraPieces);
  const jobs = loadHistoricalJobs();
  if (
    batch.optimizationRunId &&
    jobs.some((job) => job.optimizationRunId === batch.optimizationRunId)
  ) {
    return;
  }
  const jobNumber =
  jobs.reduce(
    (highest, job) =>
      Math.max(
        highest,
        job.jobNumber,
      ),
    0,
  ) + 1;

  saveHistoricalJobs([
    {
      id: crypto.randomUUID(),

      ...(batch.optimizationRunId
        ? { optimizationRunId: batch.optimizationRunId }
        : {}),

      ...(freePngPieces ? { freePngPieces } : {}),
      ...(extraPieces ? { extraPieces } : {}),

jobNumber,

name:
  `${jobNumber} (` +
  `${formatHistoricalFolderDate(createdAt)})`,

      sourceFolderPath: '',
      createdAt,
      canvasCount: Math.max(
        0,
        Math.round(batch.canvasCount),
      ),
      meters: mutableMeters,
      files: batch.files ?? [],

...(batch.sizeSummary
  ? {
      sizeSummary:
        batch.sizeSummary,
    }
  : {}),

importedHistorical: false,
    },
    ...jobs,
  ]);
}
