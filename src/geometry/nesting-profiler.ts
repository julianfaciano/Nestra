/** Temporary, per-run diagnostics. Timings are wall time, not OS CPU time. */
export interface BlockTiming {
  calls: number;
  samples: number;
  sampledMs: number;
  estimatedMs: number;
}

export const PROFILE_BLOCKS = [
  'preparation',
  'candidateCoordinates',
  'rejectionCache',
  'candidateBounds',
  'candidatePolygon',
  'canvasFit',
  'neighborLookup',
  'boundsOverlap',
  'polygonsOverlap',
] as const;
export type ProfileBlock = (typeof PROFILE_BLOCKS)[number];

const AUDIT_PROFILE_BLOCKS = [
  'candidateKey',
  'fineCandidatePolygon',
  'contact',
] as const;
type AuditProfileBlock = (typeof AUDIT_PROFILE_BLOCKS)[number];
type InternalProfileBlock = ProfileBlock | AuditProfileBlock;

export interface NestingProfile {
  sampleEvery: number;
  totalMs: number;
  /** Signed residual: sampling error can make this negative. */
  unclassifiedMs: number;
  timings: Record<InternalProfileBlock, BlockTiming>;
  counters: {
    coordinateSets: number;
    xCoordinates: number;
    yCoordinates: number;
    rejectionCacheLookups: number;
    rejectionCacheHits: number;
    cellKeys: number;
    bucketLookups: number;
    neighborCandidates: number;
    neighborDuplicates: number;
    uniqueNeighbors: number;
    segmentPairs: number;
    segmentAabbRejected: number;
    exactSegmentTests: number;
    collinearTests: number;
    pointInPolygonCalls: number;
  };
}

export function createNestingProfile(): NestingProfile {
  return {
    sampleEvery: 128,
    totalMs: 0,
    unclassifiedMs: 0,
    timings: Object.fromEntries(
      [...PROFILE_BLOCKS, ...AUDIT_PROFILE_BLOCKS].map((key) => [
        key,
        { calls: 0, samples: 0, sampledMs: 0, estimatedMs: 0 },
      ]),
    ) as Record<InternalProfileBlock, BlockTiming>,
    counters: {
      coordinateSets: 0,
      xCoordinates: 0,
      yCoordinates: 0,
      rejectionCacheLookups: 0,
      rejectionCacheHits: 0,
      cellKeys: 0,
      bucketLookups: 0,
      neighborCandidates: 0,
      neighborDuplicates: 0,
      uniqueNeighbors: 0,
      segmentPairs: 0,
      segmentAabbRejected: 0,
      exactSegmentTests: 0,
      collinearTests: 0,
      pointInPolygonCalls: 0,
    },
  };
}

/** No allocations/closures per measured operation; no clocks in segment loops. */
export function startBlock(
  profile: NestingProfile | undefined,
  key: InternalProfileBlock,
): number {
  if (!profile) return -1;
  const timing = profile.timings[key];
  timing.calls++;
  // Hash the ordinal to avoid locking sampling to repeated rotation/cache patterns.
  const hash = Math.imul(timing.calls ^ (timing.calls >>> 16), 0x45d9f3b);
  if (
    key !== 'preparation' &&
    key !== 'candidateCoordinates' &&
    timing.calls !== 1 &&
    ((hash ^ (hash >>> 16)) & 127) !== 0
  )
    return -1;
  timing.samples++;
  return performance.now();
}

export function endBlock(
  profile: NestingProfile | undefined,
  key: InternalProfileBlock,
  start: number,
): void {
  if (start >= 0 && profile)
    profile.timings[key].sampledMs += performance.now() - start;
}

export function finishProfile(profile: NestingProfile, start: number): void {
  profile.totalMs = performance.now() - start;
  let classifiedMs = 0;
  for (const timing of Object.values(profile.timings)) {
    timing.estimatedMs = timing.samples
      ? (timing.sampledMs * timing.calls) / timing.samples
      : 0;
    classifiedMs += timing.estimatedMs;
  }
  profile.unclassifiedMs = profile.totalMs - classifiedMs;
}
