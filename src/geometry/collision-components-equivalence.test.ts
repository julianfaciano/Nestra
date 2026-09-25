import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { nestMultiplePieces, type MultiNestingInput, type MultiNestingPiece } from './multi-piece-nesting-engine';
import type { Polygon } from './polygon';
import { componentEnvelope } from './polygon-components';

const rect=(w:number,h:number,x=0,y=0):Polygon=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
const free=(id:string,components:readonly Polygon[],rotations:MultiNestingPiece['allowedRotations']=[0]):MultiNestingPiece=>({id,kind:'free-png',polygon:componentEnvelope(components),collisionComponents:components,allowedRotations:rotations});
const triangleA:Polygon=[{x:0,y:0},{x:20,y:0},{x:0,y:20}];
const triangleB:Polygon=[{x:20,y:20},{x:20,y:0},{x:0,y:20}];
function radial(index:number):Polygon {
  const raw=Array.from({length:12},(_,i)=>{const a=i*Math.PI*2/12,r=.8+.15*Math.sin(a*3+index*.2);return{x:Math.cos(a)*r,y:Math.sin(a)*r};});
  const xs=raw.map(p=>p.x),ys=raw.map(p=>p.y),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  return raw.map(p=>({x:(p.x-minX)*18/(maxX-minX),y:(p.y-minY)*16/(maxY-minY)}));
}
const cases:readonly [string,MultiNestingInput][]=[
  ['single-island',{pieces:Array.from({length:8},(_,i)=>free(`s${i}`,[rect(16,12)])),canvas:{width:48,height:36},scanStepMm:10}],
  ['multiple-islands',{pieces:Array.from({length:6},(_,i)=>free(`m${i}`,[rect(8,18),rect(8,18,22,0)])),canvas:{width:60,height:54},scanStepMm:10}],
  ['components-separated',{pieces:[free('a',[rect(8,8),rect(8,8,22,22)]),free('b',[rect(8,8),rect(8,8,22,22)]),free('c',[rect(10,10)])],canvas:{width:60,height:50},scanStepMm:10}],
  ['component-aabbs-disjoint',{pieces:[free('a',[rect(18,8,0,0),rect(18,8,22,22)]),free('b',[rect(18,8,0,0),rect(18,8,22,22)]),...Array.from({length:4},(_,i)=>free(`small${i}`,[rect(7,7)]))],canvas:{width:60,height:50},scanStepMm:10}],
  ['aabb-overlap-polygons-disjoint',{pieces:[free('a',[triangleA]),free('b',[triangleB]),free('c',[triangleA]),free('d',[triangleB])],canvas:{width:50,height:40},scanStepMm:10}],
  ['real-collisions',{pieces:Array.from({length:10},(_,i)=>free(`c${i}`,[rect(24,16)])),canvas:{width:50,height:40},scanStepMm:10}],
  ['touching-allowed',{pieces:[free('left',[rect(20,20)]),free('right',[rect(20,20)]),free('top',[rect(20,20)])],canvas:{width:40,height:40},scanStepMm:10}],
  ['rotation-0',{pieces:[free('r0',[triangleA],[0]),free('r0b',[triangleA],[0])],canvas:{width:40,height:30},scanStepMm:10}],
  ['rotation-90',{pieces:[free('r90',[triangleA],[90]),free('r90b',[triangleA],[90])],canvas:{width:40,height:30},scanStepMm:10}],
  ['rotation-minus-90',{pieces:[free('rm90',[triangleA],[-90]),free('rm90b',[triangleA],[-90])],canvas:{width:40,height:30},scanStepMm:10}],
  ['rotation-180',{pieces:[free('r180',[triangleA],[180]),free('r180b',[triangleA],[180])],canvas:{width:40,height:30},scanStepMm:10}],
  ['many-unique-geometries',{pieces:Array.from({length:20},(_,i)=>free(`u${i}`,[radial(i)],[0,90,-90,180])),canvas:{width:80,height:50},scanStepMm:10}],
  ['repeated-geometry',{pieces:Array.from({length:18},(_,i)=>free(`repeat${i}`,[radial(2)],[0,90,-90,180])),canvas:{width:70,height:50},scanStepMm:10}],
  ['garment-plus-free-png',{pieces:[{id:'g1',kind:'garment',polygon:triangleA,finePolygon:triangleA,allowedRotations:[0,90]},free('p1',[triangleB],[0,90]),{id:'g2',kind:'garment',polygon:triangleB,finePolygon:triangleB,allowedRotations:[0,180]},free('p2',[triangleA],[0,90])],canvas:{width:60,height:40},scanStepMm:10}],
  ['multiple-layouts',{pieces:Array.from({length:9},(_,i)=>free(`layout${i}`,[rect(24,16)])),canvas:{width:30,height:20},scanStepMm:10}],
];

const referenceHashes:Readonly<Record<string,string>>={
  'single-island':'60b87b97cd0603394745e2b2049065f049e78b1c13aa85cff307f9171fa68352',
  'multiple-islands':'be2eb5b8426efa7faefa8302fa3e2f9c2bd6274bcfcc14ff7cb3b064d0afbd3a',
  'components-separated':'a7a4e53fb355ea36f989f3ad4e780319bed874eda1695cf5f82cabdf9336e76c',
  'component-aabbs-disjoint':'58640d27b325fb71498a0233f6dbd821e9ee320391d9c84790d011519d851269',
  'aabb-overlap-polygons-disjoint':'684b3a5df2a2ed8349b147b5d1e3f357682b36bfde59eac4881b93f9b6522585',
  'real-collisions':'55ab0ca23b37786da984f5a39c8418b560d6f1df760a424b59b3b6741c499837',
  'touching-allowed':'28e5eaa5ccbdab339ea11d59e083557fc4ac45866ca46579b21fbcb31468037b',
  'rotation-0':'54d07711d6e13fe1f2fb10df6dbf4935f1b09d78e988909ae1474d76f0db90ec',
  'rotation-90':'02ee3ab42a21e3bdce935dfe6eadc7c0da21a27ad697c9dadb86f3e1dbe366d0',
  'rotation-minus-90':'721cd926ef5d41571ded80c1e9341234b4bfa5f6cd4680af476f9e6dec314f5a',
  'rotation-180':'396042d4ca737dc00c934828a00d5a475374629e02cb61727d45abb03fba2048',
  'many-unique-geometries':'cc4be2f4d9ef21313645d4f55c27dc8f51a1b5e65ca087c14511090e6d5be24a',
  'repeated-geometry':'e303da9c34849b9ea574abeb303d2c818dabc167d91dc73eb501508d9d67f25e',
  'garment-plus-free-png':'2d715780450c62ec62f366019dd714e0145db3ca70dd4a6a71af0e8bc7d4a356',
  'multiple-layouts':'0fcb601759f451842a21e9d0949df6b2e0bed2bf9f4013758f528381e84e942f',
};

function resultHash(input:MultiNestingInput):string {
  const result=nestMultiplePieces(input);
  return createHash('sha256').update(JSON.stringify({layouts:result.layouts,unplacedPieceIds:result.unplacedPieceIds,placedCount:result.placedCount,totalPieceCount:result.totalPieceCount})).digest('hex');
}

it.each(cases)('preserves REQUIRED placement result for %s',(_name,input)=>{
  const hash=resultHash(input);
  console.info(`COMPONENT_EQUIVALENCE ${_name} ${hash}`);
  expect(hash).toBe(referenceHashes[_name]);
});

it('rejects component pairs by cached AABB before exact polygon collision',()=>{
  const input=cases.find(([name])=>name==='component-aabbs-disjoint')![1];
  const {diagnostics}=nestMultiplePieces(input);
  expect(diagnostics!.componentPairAabbRejects).toBe(76);
  expect(diagnostics!.componentPairExactChecks).toBe(27);
  expect(diagnostics!.componentPairCandidates).toBe(103);
  expect(diagnostics!.componentPairExactChecks+diagnostics!.componentPairAabbRejects).toBe(diagnostics!.componentPairCandidates);
});
