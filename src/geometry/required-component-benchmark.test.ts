import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { nestMultiplePieces, type MultiNestingInput, type MultiNestingPiece } from './multi-piece-nesting-engine';
import type { Polygon } from './polygon';
import { componentEnvelope } from './polygon-components';
import { getPolygonBounds } from './polygon-transform';

const enabled = process.env.NESTRA_REQUIRED_COMPONENT_BENCH === '1';
const bench = enabled ? it : it.skip;
const resultHashes:Readonly<Record<string,string>>={
  'garment-control':'66701239bfc0c0623cbf62cd34d8f103d973e4f2fffbfd7077942065f0b9f16b',
  'repeated-free-png-control':'e961a455423d32d636c772e19e9da6287271757e82a80ed84b7730b93993d1d3',
  'unique-free-png-replenishment':'642ff917f6b255553c5ca1a545356048b78b1b2c83436cb47253e2296bbeb0ab',
};
const enumerationBaselines:Readonly<Record<string,Readonly<Record<string,number>>>>={
  'garment-control':{requiredSearchAttempts:55,requiredCandidateEnumerations:111282,requiredCandidateFreshEnumerations:34638,requiredCandidateHistoricalReenumerations:76644,requiredDistinctHistoricalCandidates:14144,requiredSearchRestartsFromBeginning:46,requiredCandidateNewCoordinateEnumerations:9367,requiredFrontierEligibleHistoricalCandidates:75432},
  'repeated-free-png-control':{requiredSearchAttempts:52,requiredCandidateEnumerations:215010,requiredCandidateFreshEnumerations:34810,requiredCandidateHistoricalReenumerations:180200,requiredDistinctHistoricalCandidates:31093,requiredSearchRestartsFromBeginning:49,requiredCandidateNewCoordinateEnumerations:23487,requiredFrontierEligibleHistoricalCandidates:180066},
  'unique-free-png-replenishment':{requiredSearchAttempts:67,requiredCandidateEnumerations:704075,requiredCandidateFreshEnumerations:551975,requiredCandidateHistoricalReenumerations:152100,requiredDistinctHistoricalCandidates:95616,requiredSearchRestartsFromBeginning:30,requiredCandidateNewCoordinateEnumerations:19268,requiredFrontierEligibleHistoricalCandidates:152007},
};

function panel(width:number,height:number,back:boolean,notch:number):Polygon {
  return back
    ? [{x:0,y:0},{x:width,y:0},{x:width,y:height},{x:width*.78,y:height},{x:width*.72,y:height*.84},{x:width*.28,y:height*.84},{x:width*.22,y:height},{x:0,y:height}]
    : [{x:0,y:0},{x:width,y:0},{x:width,y:height*.72},{x:width*(.84+notch*.002),y:height},{x:width*(.16-notch*.002),y:height},{x:0,y:height*.72}];
}

function radial(width:number,height:number,index:number):Polygon {
  const raw=Array.from({length:16},(_,i)=>{const angle=i*Math.PI*2/16,radius=.78+.13*Math.cos(3*angle+index*.173)+.07*Math.sin(5*angle+index*.119);return{x:Math.cos(angle)*radius,y:Math.sin(angle)*radius};});
  const bounds=getPolygonBounds(raw);
  return raw.map(point=>({x:(point.x-bounds.minX)*width/bounds.width,y:(point.y-bounds.minY)*height/bounds.height}));
}

function input(kind:'garment'|'unique-free-png'|'repeated-free-png'):MultiNestingInput {
  const pieces:MultiNestingPiece[]=[];
  if(kind==='garment') {
    const quantities=[13,13,12,12];
    for(let definition=0;definition<4;definition++) {
      const back=definition>=2,width=224+definition*7,height=300+definition*8;
      const fast=panel(width,height,back,definition),fine=panel(width-.3,height-.25,back,definition);
      for(let copy=0;copy<quantities[definition]!;copy++) pieces.push({id:`garment-${definition}-${copy+1}`,kind:'garment',polygon:fast,finePolygon:fine,allowedRotations:back?[0,180]:[0,90,180,-90]});
    }
  } else {
    for(let definition=0;definition<20;definition++) {
      const quantity=[1,2,3,4][definition%4]!;
      const polygon=kind==='unique-free-png'
        ? radial(210+(definition%5)*11,292+Math.floor(definition/5)*9,definition)
        : radial(232,310,0);
      const envelope=componentEnvelope([polygon]);
      for(let copy=0;copy<quantity;copy++) pieces.push({id:`png-${definition}-${copy+1}`,kind:'free-png',polygon:envelope,finePolygon:envelope,collisionComponents:[polygon],allowedRotations:[0,90,-90,180]});
    }
  }
  return {pieces,canvas:{width:1480,height:1000},scanStepMm:22.5,diagnosticPhaseTiming:true,diagnosticRequiredScale:true,diagnosticProfiling:true,diagnosticRequiredEnumeration:true};
}

function run(name:string,data:MultiNestingInput,geometryBuckets:number) {
  const start=performance.now(),result=nestMultiplePieces(data),elapsedMs=performance.now()-start,d=result.diagnostics!;
  const attempts=d.requiredPieces!.flatMap(piece=>piece.attempts);
  const candidateCacheLookups=attempts.reduce((sum,attempt)=>sum+attempt.candidateCacheLookups,0);
  const candidateOpportunitiesPotential=attempts.reduce((sum,attempt)=>sum+attempt.candidateOpportunitiesPotential,0);
  const candidateOpportunitiesEmitted=attempts.reduce((sum,attempt)=>sum+attempt.candidateOpportunitiesEmitted,0);
  const resultHash=createHash('sha256').update(JSON.stringify({layouts:result.layouts,unplacedPieceIds:result.unplacedPieceIds,placedCount:result.placedCount,totalPieceCount:result.totalPieceCount})).digest('hex');
  const profile=d.profile!;
  const plainResult=nestMultiplePieces({...data,diagnosticRequiredEnumeration:false});
  const plainHash=createHash('sha256').update(JSON.stringify({layouts:plainResult.layouts,unplacedPieceIds:plainResult.unplacedPieceIds,placedCount:plainResult.placedCount,totalPieceCount:plainResult.totalPieceCount})).digest('hex');
  const collision=plainResult.diagnostics!.polygonCollision;
  const summary={
    name,pieces:data.pieces.length,geometryBuckets,
    RequiredMs:plainResult.diagnostics!.requiredMs,trackedRequiredMs:d.requiredMs,elapsedMs,
    candidates:d.candidatePlacementsTested,candidateCacheHits:d.candidateCacheHits,candidateCacheLookups,
    candidateCachePct:candidateCacheLookups?100*d.candidateCacheHits/candidateCacheLookups:0,
    candidateOpportunitiesPotential,candidateOpportunitiesEmitted,
    candidateOpportunitiesPruned:candidateOpportunitiesPotential-candidateOpportunitiesEmitted,
    requiredSearchAttempts:d.requiredSearchAttempts,
    requiredCandidateEnumerations:d.requiredCandidateEnumerations,
    requiredCandidateFreshEnumerations:d.requiredCandidateFreshEnumerations,
    requiredCandidateHistoricalReenumerations:d.requiredCandidateHistoricalReenumerations,
    requiredDistinctHistoricalCandidates:d.requiredDistinctHistoricalCandidates,
    requiredFirstSearchEnumerations:d.requiredFirstSearchEnumerations,
    requiredFreshEmissionsFromPreviouslyExistingCoordinates:d.requiredFreshEmissionsFromPreviouslyExistingCoordinates,
    requiredSearchRestartsFromBeginning:d.requiredSearchRestartsFromBeginning,
    requiredGridCandidatesEnumerated:d.requiredGridCandidatesEnumerated,
    requiredContactCandidatesEnumerated:d.requiredContactCandidatesEnumerated,
    requiredGridAndContactCandidatesEnumerated:d.requiredGridAndContactCandidatesEnumerated,
    requiredOtherCandidatesEnumerated:d.requiredOtherCandidatesEnumerated,
    requiredDuplicateAxisCoordinateProposals:d.requiredDuplicateAxisCoordinateProposals,
    requiredDuplicateAxisCoordinateProposalsSkipped:d.requiredDuplicateAxisCoordinateProposalsSkipped,
    requiredFrontierEligibleHistoricalCandidates:d.requiredFrontierEligibleHistoricalCandidates,
    requiredCacheHitsWithoutSameIdentityHistory:d.requiredCacheHitsWithoutSameIdentityHistory,
    requiredCandidateNewCoordinateEnumerations:d.requiredCandidateNewCoordinateEnumerations,
    requiredNewCoordinateGridCandidates:d.requiredNewCoordinateGridCandidates,
    requiredNewCoordinateContactCandidates:d.requiredNewCoordinateContactCandidates,
    requiredNewCoordinateGridAndContactCandidates:d.requiredNewCoordinateGridAndContactCandidates,
    requiredNewCoordinateOtherCandidates:d.requiredNewCoordinateOtherCandidates,
    requiredNewCoordinateCandidatesFromLastPiece:d.requiredNewCoordinateCandidatesFromLastPiece,
    requiredNewCoordinateCandidatesUsingExistingContacts:d.requiredNewCoordinateCandidatesUsingExistingContacts,
    requiredHistoricalCandidateCacheHits:d.requiredHistoricalCandidateCacheHits,
    requiredEnumerationUniqueCandidates:d.requiredEnumerationUniqueCandidates,
    requiredEnumerationMaxUniqueCandidatesPerSearchIdentityLayout:d.requiredEnumerationMaxUniqueCandidatesPerSearchIdentityLayout,
    requiredEnumerationStates:d.requiredEnumerationStates,
    enumTrackerEstimatedBytesAt96BPerKey:d.requiredEnumerationUniqueCandidates*96,
    coordinateSets:profile.counters.coordinateSets,xCoordinates:profile.counters.xCoordinates,yCoordinates:profile.counters.yCoordinates,
    transforms:d.polygonTransforms,translations:d.polygonTranslations,componentTranslations:d.componentTranslations,
    piecesUsingCollisionComponents:d.piecesUsingCollisionComponents,
    candidatesEnteringComponentPath:d.candidatesEnteringComponentPath,
    componentsOverlapCalls:d.componentsOverlapCalls,
    componentsOverlapCallsPerCandidate:d.candidatesEnteringComponentPath?d.componentsOverlapCalls/d.candidatesEnteringComponentPath:0,
    componentPairCandidates:d.componentPairCandidates,componentPairAabbRejects:d.componentPairAabbRejects,
    componentPairAabbRejectPct:d.componentPairCandidates?100*d.componentPairAabbRejects/d.componentPairCandidates:0,
    componentPairBoundsRecomputed:d.componentPairBoundsRecomputed,
    componentBoundsPrecomputations:d.componentBoundsPrecomputations,
    componentPairExactChecks:d.componentPairExactChecks,
    componentPairExactPct:d.componentPairCandidates?100*d.componentPairExactChecks/d.componentPairCandidates:0,
    componentPairExactCollisions:d.componentPairExactCollisions,broad:d.broadPhaseChecks,
    exactCounter:d.exactPolygonCollisionChecks,failedVersionMemo:d.requiredFailedVersionHits,
    componentOverlapMs:profile.timings.componentOverlap.estimatedMs,
    candidateCoordinatesMs:profile.timings.candidateCoordinates.estimatedMs,
    candidateKeyMs:profile.timings.candidateKey.estimatedMs,
    candidateGenerationMs:profile.timings.candidateGeneration.estimatedMs,
    rejectionCacheMs:profile.timings.rejectionCache.estimatedMs,
    plainCandidateCoordinatesMs:plainResult.diagnostics!.profile!.timings.candidateCoordinates.estimatedMs,
    plainCandidateKeyMs:plainResult.diagnostics!.profile!.timings.candidateKey.estimatedMs,
    plainRejectionCacheMs:plainResult.diagnostics!.profile!.timings.rejectionCache.estimatedMs,
    plainComponentOverlapMs:plainResult.diagnostics!.profile!.timings.componentOverlap.estimatedMs,
    exactCollisionCalls:collision.exactCollisionCalls,
    exactCollisionEarlyRejects:collision.exactCollisionEarlyRejects,
    exactCollisionSegmentPairCandidates:collision.exactCollisionSegmentPairCandidates,
    exactCollisionSegmentPairAabbRejects:collision.exactCollisionSegmentPairAabbRejects,
    exactCollisionSegmentPairTests:collision.exactCollisionSegmentPairTests,
    exactCollisionSegmentIntersections:collision.exactCollisionSegmentIntersections,
    exactCollisionContainmentTests:collision.exactCollisionContainmentTests,
    exactCollisionTemporaryPolygonMaterializations:collision.exactCollisionTemporaryPolygonMaterializations,
    exactCollisionVerticesMaterialized:collision.exactCollisionVerticesMaterialized,
    exactCollisionTranslatedBoundsMaterializations:collision.exactCollisionTranslatedBoundsMaterializations,
    exactCollisionCandidateScratchArrays:collision.exactCollisionCandidateScratchArrays,
    exactCollisionTemporaryPointObjects:collision.exactCollisionTemporaryPointObjects,
    exactCollisionBoundsMs:collision.exactCollisionTimingSamples?collision.exactCollisionBoundsSampledMs*collision.exactCollisionCalls/collision.exactCollisionTimingSamples:0,
    exactCollisionSegmentMs:collision.exactCollisionTimingSamples?collision.exactCollisionSegmentSampledMs*collision.exactCollisionCalls/collision.exactCollisionTimingSamples:0,
    exactCollisionContainmentMs:collision.exactCollisionTimingSamples?collision.exactCollisionContainmentSampledMs*collision.exactCollisionCalls/collision.exactCollisionTimingSamples:0,
    exactCollisionMs:collision.exactCollisionTimingSamples?collision.exactCollisionTotalSampledMs*collision.exactCollisionCalls/collision.exactCollisionTimingSamples:0,
    exactCollisionMaterializationMs:collision.exactCollisionMaterializationSamples?collision.exactCollisionMaterializationSampledMs*collision.exactCollisionTemporaryPolygonMaterializations/collision.exactCollisionMaterializationSamples:0,
    exactCollisionTimingSamples:collision.exactCollisionTimingSamples,
    exactCollisionBoundsSamples:collision.exactCollisionBoundsSamples,
    exactCollisionSegmentSamples:collision.exactCollisionSegmentSamples,
    exactCollisionContainmentSamples:collision.exactCollisionContainmentSamples,
    exactCollisionMaterializationSamples:collision.exactCollisionMaterializationSamples,
    layouts:result.layouts.length,usedHeights:result.layouts.map(layout=>layout.usedHeight),
    unplaced:result.unplacedPieceIds.length,resultHash,
  };
  console.info(`REQUIRED_COMPONENT_BENCH ${JSON.stringify(summary)}`);
  expect(plainHash).toBe(resultHash);
  expect(collision.exactCollisionCalls).toBe(d.componentPairExactChecks);
  expect(collision.exactCollisionTemporaryPolygonMaterializations).toBe(d.componentTranslations);
  expect(collision.exactCollisionSegmentPairCandidates).toBe(collision.exactCollisionSegmentPairAabbRejects+collision.exactCollisionSegmentPairTests);
  expect(candidateCacheLookups).toBe(d.requiredCandidateEnumerations);
  expect(d.requiredCandidateFreshEnumerations+d.requiredCandidateHistoricalReenumerations).toBe(d.requiredCandidateEnumerations);
  expect(d.requiredFirstSearchEnumerations+d.requiredFreshEmissionsFromPreviouslyExistingCoordinates+d.requiredCandidateNewCoordinateEnumerations).toBe(d.requiredCandidateFreshEnumerations);
  expect(d.requiredDuplicateAxisCoordinateProposals).toBe(d.requiredDuplicateAxisCoordinateProposalsSkipped);
  expect(d.requiredFrontierEligibleHistoricalCandidates+d.requiredCacheHitsWithoutSameIdentityHistory).toBe(d.candidateCacheHits);
  expect(d.requiredNewCoordinateGridCandidates+d.requiredNewCoordinateContactCandidates-d.requiredNewCoordinateGridAndContactCandidates+d.requiredNewCoordinateOtherCandidates).toBe(d.requiredCandidateNewCoordinateEnumerations);
  expect({
    requiredSearchAttempts:d.requiredSearchAttempts,
    requiredCandidateEnumerations:d.requiredCandidateEnumerations,
    requiredCandidateFreshEnumerations:d.requiredCandidateFreshEnumerations,
    requiredCandidateHistoricalReenumerations:d.requiredCandidateHistoricalReenumerations,
    requiredDistinctHistoricalCandidates:d.requiredDistinctHistoricalCandidates,
    requiredSearchRestartsFromBeginning:d.requiredSearchRestartsFromBeginning,
    requiredCandidateNewCoordinateEnumerations:d.requiredCandidateNewCoordinateEnumerations,
    requiredFrontierEligibleHistoricalCandidates:d.requiredFrontierEligibleHistoricalCandidates,
  }).toEqual(enumerationBaselines[name]);
  expect(resultHash).toBe(resultHashes[name]);
  expect(result.unplacedPieceIds).toEqual([]);expect(result.layouts).toHaveLength(3);expect(result.placedCount).toBe(50);
  return summary;
}

bench('measures REQUIRED component collision work for the 50-piece replenishment fixture',()=>{
  run('garment-control',input('garment'),4);
  run('repeated-free-png-control',input('repeated-free-png'),1);
  run('unique-free-png-replenishment',input('unique-free-png'),20);
},60_000);
