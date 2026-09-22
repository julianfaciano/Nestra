import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  nestMultiplePieces,
  type MultiNestingInput,
} from './multi-piece-nesting-engine';
import { polygonsOverlap, createPolygonSegmentQuery } from './polygon-collision';
import { getPolygonBounds, transformPolygon } from './polygon-transform';
import { rect } from '../test/fill-gaps-fixture';
import { componentEnvelope, componentsOverlap } from './polygon-components';
import { polygonsTouch, createIndexedPolygonTouch, localContourSnaps } from './polygon-contact';

it('deduplicates local dense snaps while preserving the complete pre-optimization filler result', () => {
  const polygon=Array.from({length:64},(_,i)=>({
    x:10*(1+Math.cos(i*2*Math.PI/64)),y:8*(1+Math.sin(i*2*Math.PI/64)),
  }));
  const snaps=[...localContourSnaps([polygon],0,0,
    [polygon.map(p=>({x:p.x+20,y:p.y}))],10,createPolygonSegmentQuery())];
  expect(snaps.length).toBeGreaterThan(0);
  expect(new Set(snaps.map(p=>`${p.x},${p.y}`)).size).toBe(snaps.length);
  const data: MultiNestingInput={canvas:{width:240,height:200},scanStepMm:10,pieces:[
    {id:'base',polygon:[{x:0,y:0},{x:100,y:0},{x:120,y:200},{x:0,y:200}],allowedRotations:[0]},
    {id:'png',kind:'free-png',polygon,collisionComponents:[polygon],allowedRotations:[0]},
  ],fillers:[{definitionId:'png',requiredPieceId:'png',priority:1,mode:'max'}]};
  const result=nestMultiplePieces(data);
  expect(result.extraCount).toBe(75);
  expect(result.layouts).toHaveLength(1);
  expect(result.layouts[0]!.usedHeight).toBe(200);
  expect(result.layouts[0]!.requiredUsedHeight).toBe(200);
  // Captured before local deduplication: includes all components, IDs, order,
  // rotations, required placements, extra identities and frozen material.
  expect(createHash('sha256').update(JSON.stringify(result.layouts)).digest('hex'))
    .toBe('d03cf2971dbade6c5b01c179ca6abacc4434728b81cd72e4d08addd46fabf96b');
});

function input(): MultiNestingInput {
  return {
    canvas: { width: 100, height: 200 },
    scanStepMm: 10,
    pieces: [
      { id: 'base', polygon: rect(60, 100), allowedRotations: [0] },
      ...Array.from({ length: 3 }, (_, i) => ({
        id: `a-${i + 1}`,
        polygon: rect(20, 20),
        allowedRotations: [0, 90, -90, 180] as const,
      })),
    ],
  };
}
const filler = { definitionId: 'a', requiredPieceId: 'a-1', priority: 1, mode: 'normal' as const };

it('snaps to an irregular contour between grid positions and later touches another extra', () => {
  const trapezoid=[{x:0,y:0},{x:40,y:0},{x:60,y:100},{x:0,y:100}];
  const touching=rect(5,5).map(p=>({x:p.x+49,y:p.y+40}));
  const separated=rect(5,5).map(p=>({x:p.x+50,y:p.y+40}));
  expect(polygonsOverlap(touching,trapezoid)).toBe(false);
  expect(polygonsTouch(touching,trapezoid)).toBe(true);
  expect(polygonsOverlap(separated,trapezoid)).toBe(false);
  expect(polygonsTouch(separated,trapezoid)).toBe(false);
  const data:MultiNestingInput={canvas:{width:100,height:100},scanStepMm:10,
    pieces:[{id:'base',polygon:trapezoid,allowedRotations:[0]},
      {id:'a-1',kind:'free-png',polygon:rect(5,5),collisionComponents:[rect(5,5)],allowedRotations:[0]}],fillers:[filler]};
  const result=nestMultiplePieces(data),layout=result.layouts[0]!;
  const extras=layout.pieces.filter(p=>p.extra);
  expect(polygonsTouch(extras[0]!.collisionComponents![0]!,trapezoid)).toBe(true);
  expect(extras[0]!.placement.x % data.scanStepMm!).not.toBe(0);
  expect(extras.some((p,i)=>extras.slice(0,i).some(q=>polygonsTouch(p.collisionComponents![0]!,q.collisionComponents![0]!)))).toBe(true);
  for(const [i,p] of layout.pieces.entries()) for(const q of layout.pieces.slice(i+1)) {
    expect(componentsOverlap(p.collisionComponents??[p.polygon],q.collisionComponents??[q.polygon])).toBe(false);
  }
  expect(layout.pieces.every(p=>getPolygonBounds(p.polygon).maxY<=100)).toBe(true);
  expect(result.layouts).toHaveLength(1);
  expect(layout.usedHeight).toBe(100);
  expect(layout.requiredUsedHeight).toBe(100);
  expect(nestMultiplePieces(data)).toEqual(result);
});

it('rejects filler contact inside a fine-contour notch occupied by the exported fast contour', () => {
  const fine = [{x:0,y:0},{x:60,y:0},{x:60,y:10},{x:50,y:10},
    {x:50,y:90},{x:60,y:90},{x:60,y:100},{x:0,y:100}];
  const result=nestMultiplePieces({canvas:{width:100,height:100},scanStepMm:10,
    pieces:[{id:'base',polygon:rect(60,100),finePolygon:fine,allowedRotations:[0]},
      {id:'a-1',kind:'free-png',polygon:rect(5,5),collisionComponents:[rect(5,5)],allowedRotations:[0]}],
    fillers:[filler]});
  expect(result.extraCount).toBeGreaterThan(0);
  expect(result.layouts).toHaveLength(1);
  expect(result.layouts[0]!.usedHeight).toBe(100);
  const pieces=result.layouts[0]!.pieces;
  // Exactly the geometry used by preflight, without the segment index.
  for(const [i,p] of pieces.entries()) for(const q of pieces.slice(i+1)) {
    expect(componentsOverlap(p.collisionComponents??[p.polygon],q.collisionComponents??[q.polygon])).toBe(false);
  }
});

it('leaves the entire result unchanged when no fillers are requested', () => {
  expect(nestMultiplePieces({ ...input(), fillers: [] })).toEqual(
    nestMultiplePieces(input()),
  );
});

it('adds seven extras separately from three required copies without changing layouts, heights or meters', () => {
  const original = input();
  const before = structuredClone(original);
  const required = nestMultiplePieces(original);
  const filled = nestMultiplePieces({ ...original, fillers: [filler] });
  expect(original).toEqual(before);
  expect(filled.layouts).toHaveLength(required.layouts.length);
  expect(filled.placedCount).toBe(4);
  expect(filled.totalPieceCount).toBe(4);
  expect(filled.extraCount).toBe(7);
  expect(
    filled.layouts
      .flatMap((l) => l.pieces)
      .filter((p) => !p.extra && p.pieceId.startsWith('a-')),
  ).toHaveLength(3);
  expect(filled.layouts.map((l) => l.usedHeight)).toEqual(
    required.layouts.map((l) => l.usedHeight),
  );
  expect(filled.layouts.reduce((sum, l) => sum + l.usedHeight / 1000, 0)).toBe(
    required.layouts.reduce((sum, l) => sum + l.usedHeight / 1000, 0),
  );
  for (const [i, layout] of filled.layouts.entries()) {
    expect(layout.pieces.filter((p) => !p.extra)).toEqual(
      required.layouts[i]!.pieces,
    );
    expect(layout.requiredUsedHeight).toBe(required.layouts[i]!.usedHeight);
    for (const [j, piece] of layout.pieces.entries()) {
      const bounds = getPolygonBounds(piece.polygon);
      expect(bounds.minX).toBeGreaterThanOrEqual(0);
      expect(bounds.minY).toBeGreaterThanOrEqual(0);
      expect(bounds.maxX).toBeLessThanOrEqual(100);
      expect(bounds.maxY).toBeLessThanOrEqual(layout.requiredUsedHeight!);
      if (piece.extra)
        expect([0, 90, -90, 180]).toContain(piece.placement.rotation);
      for (const other of layout.pieces.slice(j + 1))
        expect(polygonsOverlap(piece.polygon, other.polygon)).toBe(false);
    }
  }
  const extras = filled.layouts.flatMap((l) => l.pieces).filter((p) => p.extra);
  expect(extras.map((p) => p.extra!.copyIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  expect(
    new Set(filled.layouts.flatMap((l) => l.pieces.map((p) => p.pieceId))).size,
  ).toBe(11);
  expect(nestMultiplePieces({ ...original, fillers: [filler] })).toEqual(
    filled,
  );
});

it('fills active fillers in round-robin order and then removes exhausted fillers', () => {
  const data: MultiNestingInput = {
    ...input(),
    pieces: [
      input().pieces[0]!,
      input().pieces[1]!,
      { id: 'b-1', polygon: rect(10, 10), allowedRotations: [0, 90, -90, 180] },
    ],
    fillers: [
      filler,
      { definitionId: 'b', requiredPieceId: 'b-1', priority: 2, mode: 'normal' as const },
    ],
  };
  const filled = nestMultiplePieces(data);
  const extras = filled.layouts
    .flatMap((l) => l.pieces)
    .filter((p) => p.extra)
    .map((p) => p.extra!.definitionId);
  expect(extras.slice(0, 6)).toEqual(['a', 'b', 'a', 'b', 'a', 'b']);
  expect(new Set(extras)).toEqual(new Set(['a', 'b']));
  const reversed = nestMultiplePieces({
    ...data,
    fillers: [
      { ...filler, priority: 2 },
      { definitionId: 'b', requiredPieceId: 'b-1', priority: 1, mode: 'normal' as const },
    ],
  });
  const reversedExtras = reversed.layouts
    .flatMap((l) => l.pieces)
    .filter((p) => p.extra)
    .map((p) => p.extra!.definitionId);
  expect(reversedExtras.slice(0, 4)).toEqual(['b', 'a', 'b', 'a']);
});

it('does not create new layouts when none of the existing material has room', () => {
  const data: MultiNestingInput = {
    canvas: { width: 100, height: 200 },
    pieces: [
      {
        id: 'a-1',
        polygon: rect(100, 100),
        allowedRotations: [0, 90, -90, 180],
      },
    ],
    fillers: [filler],
  };
  const result = nestMultiplePieces(data);
  expect(result.extraCount).toBe(0);
  expect(result.layouts).toHaveLength(1);
  expect(result.layouts[0]!.usedHeight).toBe(100);
});

it('supports more than 100 extras without an arbitrary cap', () => {
  const result = nestMultiplePieces({
    canvas: { width: 100, height: 100 },
    scanStepMm: 5,
    pieces: [
      { id: 'base', polygon: rect(40, 100), allowedRotations: [0] },
      { id: 'a-1', polygon: rect(5, 5), allowedRotations: [0] },
    ],
    fillers: [filler],
  });
  expect(result.extraCount).toBe(239);
  // Contact ranking may revisit viable finalists, never the rejected prefix.
  // Before ranking: 445 candidates and 29,084 broad-phase checks.
  expect(result.diagnostics!.candidateCacheHits).toBe(0);
  expect(result.diagnostics!.candidatePlacementsTested).toBeLessThan(445 * 2);
  expect(result.diagnostics!.broadPhaseChecks).toBeLessThan(29084 / 10);
  expect(result.layouts).toHaveLength(1);
  expect(result.layouts[0]!.usedHeight).toBe(100);
});

it.each([false,true])('prefers filler contact over an earlier valid gap (multiple islands: %s)', multiple => {
  const parts = multiple ? [rect(5,5),rect(5,5).map(p=>({x:p.x+10,y:p.y+10}))] : [rect(5,5)];
  const data: MultiNestingInput = {canvas:{width:100,height:100},scanStepMm:10,
    pieces:[{id:'base',polygon:rect(60,100),allowedRotations:[0]},
      {id:'a-1',kind:'free-png',polygon:componentEnvelope(parts),collisionComponents:parts,allowedRotations:[0]}],
    fillers:[filler]};
  const result=nestMultiplePieces(data);
  const layout=result.layouts[0]!;
  const required=layout.pieces.filter(p=>!p.extra);
  const gap=parts.map(p=>p.map(v=>({x:v.x+70,y:v.y})));
  for(const p of required) {
    expect(componentsOverlap(gap,p.collisionComponents??[p.polygon])).toBe(false);
    expect(gap.some(a=>(p.collisionComponents??[p.polygon]).some(b=>polygonsTouch(a,b)))).toBe(false);
  }
  const first=layout.pieces.find(p=>p.extra)!;
  const indexedTouch=createIndexedPolygonTouch();
  for(const a of first.collisionComponents!) for(const p of required) for(const b of p.collisionComponents??[p.polygon]) {
    expect(indexedTouch(a,b)).toBe(polygonsTouch(a,b));
  }
  // The new contour snap reaches y=5; the old grid stopped at y=10.
  expect(first.placement).toEqual({x:60,y:5,rotation:0});
  expect(polygonsTouch(first.collisionComponents![0]!,required[0]!.polygon)).toBe(true);
  if(multiple) expect(polygonsTouch(first.collisionComponents![1]!,required[0]!.polygon)).toBe(false);
  for(const [i,p] of layout.pieces.entries()) for(const q of layout.pieces.slice(i+1)) {
    expect(componentsOverlap(p.collisionComponents??[p.polygon],q.collisionComponents??[q.polygon])).toBe(false);
  }
  expect(result.layouts).toHaveLength(1);
  expect(layout.usedHeight).toBe(100);
  expect(layout.requiredUsedHeight).toBe(100);
  expect(nestMultiplePieces(data)).toEqual(result);
});

it('ranks filler contact by distinct neighbors before x and y', () => {
  const result=nestMultiplePieces({canvas:{width:100,height:60},scanStepMm:10,
    pieces:[{id:'base',polygon:rect(40,60),allowedRotations:[0]},
      {id:'a-1',polygon:rect(20,20),allowedRotations:[0]},
      {id:'b-1',polygon:rect(20,20),allowedRotations:[0]}],fillers:[filler]});
  const layout=result.layouts[0]!;
  const first=layout.pieces.find(p=>p.extra)!;
  expect(first.placement).toEqual({x:40,y:20,rotation:0});
  expect(layout.pieces.filter(p=>!p.extra && polygonsTouch(first.polygon,p.polygon))).toHaveLength(3);
  expect(layout.usedHeight).toBe(60);
});

it('rejects degenerate fillers as non-consuming without looping', () => {
  const result = nestMultiplePieces({
    canvas: { width: 100, height: 100 },
    pieces: [
      {
        id: 'a-1',
        polygon: [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 40, y: 0 },
        ],
        allowedRotations: [0],
      },
    ],
    fillers: [filler],
  });
  expect(result.extraCount).toBe(0);
});

it('checks the fine contour against frozen height and both required and extra neighbors', () => {
  const data: MultiNestingInput = {
    ...input(),
    pieces: [
      input().pieces[0]!,
      {
        ...input().pieces[1]!,
        finePolygon: rect(21, 21),
      },
    ],
    fillers: [filler],
  };
  const result = nestMultiplePieces(data);
  expect(result.extraCount).toBeGreaterThan(0);
  for (const layout of result.layouts)
    for (const p of layout.pieces.filter((p) => p.extra)) {
      expect(p.placement.y + 21).toBeLessThanOrEqual(
        layout.requiredUsedHeight!,
      );
    }
  for (const layout of result.layouts) {
    const fine = layout.pieces.map((p) =>
      transformPolygon(
        p.pieceId === 'base' ? rect(60, 100) : rect(21, 21),
        p.placement,
      ),
    );
    for (const [i, polygon] of fine.entries())
      for (const other of fine.slice(i + 1))
        expect(polygonsOverlap(polygon, other)).toBe(false);
  }
});

it('fills concave alpha holes instead of treating the required piece as a solid rectangle', () => {
  const result = nestMultiplePieces({
    canvas: { width: 100, height: 200 },
    scanStepMm: 20,
    pieces: [
      {
        id: 'base',
        polygon: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 20 },
          { x: 20, y: 20 },
          { x: 20, y: 100 },
          { x: 0, y: 100 },
        ],
        allowedRotations: [0],
      },
      { id: 'a-1', polygon: rect(20, 20), allowedRotations: [0, 90, -90, 180] },
    ],
    fillers: [filler],
  });
  expect(result.extraCount).toBe(15);
  expect(result.layouts[0]!.usedHeight).toBe(100);
});

it('rotates extras when a quarter turn is needed to fit the existing strip', () => {
  const result = nestMultiplePieces({
    canvas: { width: 100, height: 200 },
    scanStepMm: 10,
    pieces: [
      { id: 'base', polygon: rect(80, 100), allowedRotations: [0] },
      { id: 'a-1', polygon: rect(40, 20), allowedRotations: [0, 90, -90, 180] },
    ],
    fillers: [filler],
  });
  expect(result.extraCount).toBe(1);
  expect(
    result.layouts[0]!.pieces.find((p) => p.extra)!.placement.rotation,
  ).toBe(90);
});

it('keeps stable copy indices for each filler across all existing canvases', () => {
  const data: MultiNestingInput = {
    canvas: { width: 100, height: 100 },
    scanStepMm: 10,
    pieces: [
      { id: 'base1', polygon: rect(60, 100), allowedRotations: [0] },
      { id: 'base2', polygon: rect(60, 100), allowedRotations: [0] },
      { id: 'a-1', polygon: rect(20, 20), allowedRotations: [0] },
      { id: 'b-1', polygon: rect(20, 20), allowedRotations: [0] },
    ],
    fillers: [
      filler,
      { definitionId: 'b', requiredPieceId: 'b-1', priority: 2, mode: 'normal' as const },
    ],
  };
  const result = nestMultiplePieces(data);
  expect(result.layouts).toHaveLength(2);
  expect(result.layouts.map((l) => l.usedHeight)).toEqual([100, 100]);
  const extras = result.layouts.flatMap((l) => l.pieces).filter((p) => p.extra);
  expect(extras).toHaveLength(18);
  const byDefinition = new Map<string, number[]>();
  for (const piece of extras) {
    const definitionId = piece.extra!.definitionId;
    const indices = byDefinition.get(definitionId) ?? [];
    indices.push(piece.extra!.copyIndex);
    byDefinition.set(definitionId, indices);
  }
  expect(byDefinition.size).toBe(2);
  for (const indices of byDefinition.values()) {
    expect(indices.sort((a, b) => a - b)).toEqual(
      Array.from({ length: indices.length }, (_, i) => i),
    );
  }
});

it('exhausts MAX fillers before normal round-robin fillers without changing material', () => {
  const result = nestMultiplePieces({
    canvas: { width: 100, height: 100 },
    scanStepMm: 10,
    pieces: [
      { id: 'base', polygon: rect(60, 100), allowedRotations: [0] },
      { id: 'a-1', polygon: rect(20, 20), allowedRotations: [0] },
      { id: 'b-1', polygon: rect(20, 20), allowedRotations: [0] },
    ],
    fillers: [
      { definitionId: 'a', requiredPieceId: 'a-1', priority: 1, mode: 'normal' },
      { definitionId: 'b', requiredPieceId: 'b-1', priority: 2, mode: 'max' },
    ],
  });
  const extras = result.layouts.flatMap((layout) => layout.pieces).filter((piece) => piece.extra);
  const firstNormal = extras.findIndex((piece) => piece.extra!.definitionId === 'a');
  expect(extras.some((piece) => piece.extra!.definitionId === 'b')).toBe(true);
  if (firstNormal >= 0) {
    expect(extras.slice(0, firstNormal).every((piece) => piece.extra!.definitionId === 'b')).toBe(true);
  }
  expect(result.layouts.every((layout) => layout.usedHeight === layout.requiredUsedHeight)).toBe(true);
  expect(nestMultiplePieces({
    canvas: { width: 100, height: 100 },
    scanStepMm: 10,
    pieces: [
      { id: 'base', polygon: rect(60, 100), allowedRotations: [0] },
      { id: 'a-1', polygon: rect(20, 20), allowedRotations: [0] },
      { id: 'b-1', polygon: rect(20, 20), allowedRotations: [0] },
    ],
    fillers: [
      { definitionId: 'a', requiredPieceId: 'a-1', priority: 1, mode: 'normal' },
      { definitionId: 'b', requiredPieceId: 'b-1', priority: 2, mode: 'max' },
    ],
  })).toEqual(result);
});
