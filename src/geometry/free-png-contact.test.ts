import { expect, it } from 'vitest';
import { nestMultiplePieces, type MultiNestingInput } from './multi-piece-nesting-engine';
import { polygonsTouch } from './polygon-contact';
import { polygonsOverlap } from './polygon-collision';
import { getPolygonBounds } from './polygon-transform';
import { rect } from '../test/fill-gaps-fixture';

it('prunes worse x at tied height without changing the dense-contour reference placements', () => {
  const polygon=Array.from({length:160},(_,i)=>{
    const angle=2*Math.PI*i/160;
    return {x:251.5*(1+Math.cos(angle)),y:76.5*(1+Math.sin(angle))};
  });
  const data: MultiNestingInput={canvas:{width:1480,height:1000},scanStepMm:10,
    pieces:Array.from({length:10},(_,i)=>({id:String(i),kind:'free-png',polygon,
      collisionComponents:[polygon],allowedRotations:[0,90,-90,180]}))};
  const result=nestMultiplePieces(data);
  // Captured from the contact-scored engine BEFORE adding x pruning.
  const reference=[[0,0],[503,0],[350,150],[853,150],[0,300],
    [503,300],[190,450],[693,450],[0,600],[503,600]];
  expect(result.layouts).toHaveLength(1);
  expect(result.layouts[0]!.usedHeight).toBe(753);
  expect(result.unplacedPieceIds).toEqual([]);
  expect(result.layouts[0]!.pieces.map(p=>({id:p.pieceId,...p.placement}))).toEqual(
    reference.map(([x,y],i)=>({id:String(i),x,y,rotation:0})));
  // Work budget, not a wall-clock assertion: the reference evaluated 1,789.
  expect(result.diagnostics!.candidatePlacementsTested).toBeLessThan(1700);
  expect(nestMultiplePieces(data).layouts).toEqual(result.layouts);
});

function input(): MultiNestingInput {
  return { canvas: { width: 1480, height: 1000 }, scanStepMm: 10, pieces: [
    { id: 'other', kind: 'free-png', polygon: rect(507,307), collisionComponents: [rect(507,307)], allowedRotations: [0] },
    ...Array.from({length:10}, (_,i) => ({ id: `rectangle-${i}`, kind: 'free-png' as const,
      polygon: rect(503,153), collisionComponents: [rect(503,153)], allowedRotations: [0] as const })),
  ] };
}

it('packs ten off-grid required PNG rectangles with lateral and vertical real contact', () => {
  const data=input();
  const result=nestMultiplePieces(data);
  expect(result.layouts).toHaveLength(1);
  const pieces=result.layouts[0]!.pieces;
  expect(result.layouts[0]!.usedHeight).toBeLessThanOrEqual(953); // Original required search.
  expect(pieces).toHaveLength(11);
  expect(pieces.every(p=>!p.extra)).toBe(true);
  let lateral=0, vertical=0;
  for(let i=1;i<pieces.length;i++) {
    const p=pieces[i]!, previous=pieces.slice(0,i);
    expect(previous.some(q=>polygonsTouch(p.polygon,q.polygon))).toBe(true);
    for(const q of previous) {
      expect(polygonsOverlap(p.polygon,q.polygon)).toBe(false);
      if(!polygonsTouch(p.polygon,q.polygon)) continue;
      const a=getPolygonBounds(p.polygon),b=getPolygonBounds(q.polygon);
      if(a.minX===b.maxX || a.maxX===b.minX) lateral++;
      if(a.minY===b.maxY || a.maxY===b.minY) vertical++;
    }
  }
  expect(lateral).toBeGreaterThan(0);
  expect(vertical).toBeGreaterThan(0);
  expect(polygonsTouch(pieces[1]!.polygon,pieces[0]!.polygon)).toBe(true);
  expect(pieces.slice(2).some((p,i)=>pieces.slice(1,i+2).some(q=>polygonsTouch(p.polygon,q.polygon)))).toBe(true);
  // Both are legal: only the exact pose contacts the other design.
  const touching=rect(503,153).map(p=>({x:p.x+507,y:p.y}));
  const separated=rect(503,153).map(p=>({x:p.x+510,y:p.y}));
  expect(polygonsOverlap(touching,pieces[0]!.polygon)).toBe(false);
  expect(polygonsOverlap(separated,pieces[0]!.polygon)).toBe(false);
  expect(polygonsTouch(separated,pieces[0]!.polygon)).toBe(false);
  expect(pieces[1]!.placement).toEqual({x:507,y:0,rotation:0});
  expect(nestMultiplePieces(data)).toEqual(result);
});

it('keeps the ten required copies unchanged when filling is enabled, including quarter turns', () => {
  const data: MultiNestingInput = {...input(), pieces: input().pieces.map(p=>({
    ...p, allowedRotations: [0,90,-90,180],
  }))};
  const required=nestMultiplePieces(data);
  const filled=nestMultiplePieces({...data,fillers:[{
    definitionId:'rectangle',requiredPieceId:'rectangle-0',priority:1,mode:'max',
  }]});
  expect(filled.layouts).toHaveLength(required.layouts.length);
  for(const [i,layout] of filled.layouts.entries()) {
    expect(layout.pieces.filter(p=>!p.extra)).toEqual(required.layouts[i]!.pieces);
    expect(layout.usedHeight).toBe(required.layouts[i]!.usedHeight);
    expect(layout.requiredUsedHeight).toBe(required.layouts[i]!.usedHeight);
  }
  expect(filled.layouts.flatMap(l=>l.pieces).filter(p=>!p.extra && p.pieceId.startsWith('rectangle-'))).toHaveLength(10);
  expect(nestMultiplePieces(data)).toEqual(required);
});
