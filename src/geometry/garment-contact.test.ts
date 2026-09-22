import { expect, it, vi } from 'vitest';
import * as contactGeometry from './polygon-contact';
import { nestMultiplePieces, type MultiNestingInput } from './multi-piece-nesting-engine';
import { polygonsTouch } from './polygon-contact';
import { polygonsOverlap } from './polygon-collision';
import { rect } from '../test/fill-gaps-fixture';

function input(kind?: 'garment' | 'free-png'): MultiNestingInput {
  return { canvas: { width: 100, height: 100 }, scanStepMm: 10,
    pieces: [
      { id: 'a', polygon: rect(33, 40), allowedRotations: [0], ...(kind ? { kind } : {}) },
      { id: 'b', polygon: rect(23, 30), allowedRotations: [0, 180], ...(kind ? { kind } : {}) },
    ] };
}

it('prefers exact garment contact over a gap at the same used height', () => {
  const before = nestMultiplePieces(input());
  const after = nestMultiplePieces(input('garment'));
  const [a, b] = after.layouts[0]!.pieces;
  expect(before.layouts[0]!.pieces[1]!.placement.x).toBe(40);
  expect(b!.placement).toEqual({ x: 33, y: 0, rotation: 0 });
  expect(polygonsTouch(a!.polygon, b!.polygon)).toBe(true);
  expect(polygonsOverlap(a!.polygon, b!.polygon)).toBe(false);
  expect(a).toEqual(before.layouts[0]!.pieces[0]);
  expect(after.layouts).toHaveLength(before.layouts.length);
  expect(after.layouts[0]!.usedHeight).toBe(40);
  expect(nestMultiplePieces(input('garment'))).toEqual(after);
});

it('keeps the third garment upstairs even when a lower placement touches two garments', () => {
  const data: MultiNestingInput = { canvas: {width:150,height:100}, scanStepMm:10,
    pieces: [40,40,30].map((size,i)=>({id:String(i),kind:'garment',polygon:rect(size,size),allowedRotations:[0]})) };
  const result = nestMultiplePieces(data);
  const [a,b,c] = result.layouts[0]!.pieces;
  const lower = rect(30,30).map(p=>({x:p.x+20,y:p.y+40}));
  for (const upper of [a!,b!]) {
    expect(polygonsTouch(lower,upper.polygon)).toBe(true);
    expect(polygonsOverlap(lower,upper.polygon)).toBe(false);
  }
  expect(c!.placement).toEqual({x:80,y:0,rotation:0});
  expect([a!,b!].filter(p=>polygonsTouch(c!.polygon,p.polygon))).toHaveLength(1);
  expect(result.layouts).toHaveLength(1);
  expect(result.layouts[0]!.usedHeight).toBe(40);
  expect(nestMultiplePieces(data)).toEqual(result);
});

it('prefers the leftward position before the upper position at the same used height', () => {
  const result = nestMultiplePieces({
    canvas: { width: 150, height: 100 },
    scanStepMm: 10,
    pieces: [[40, 60], [40, 40], [20, 20]].map(([w, h], i) => ({
      id: String(i),
      kind: 'garment',
      polygon: rect(w!, h!),
      allowedRotations: [0],
    })),
  });

  const [a, b, c] = result.layouts[0]!.pieces;

  expect(c!.placement).toEqual({ x: 40, y: 40, rotation: 0 });
expect(polygonsTouch(c!.polygon, a!.polygon)).toBe(true);
expect(polygonsTouch(c!.polygon, b!.polygon)).toBe(true);
expect(polygonsOverlap(c!.polygon, a!.polygon)).toBe(false);
expect(polygonsOverlap(c!.polygon, b!.polygon)).toBe(false);
  expect(result.layouts[0]!.usedHeight).toBe(60);
});

it('starts a new row from the left when used height and y are equal', () => {
  const result = nestMultiplePieces({
    canvas: { width: 100, height: 100 },
    scanStepMm: 10,
    pieces: [
      { id: 'a', kind: 'garment', polygon: rect(60, 40), allowedRotations: [0] },
      { id: 'b', kind: 'garment', polygon: rect(40, 40), allowedRotations: [0] },
      { id: 'c', kind: 'garment', polygon: rect(20, 20), allowedRotations: [0] },
    ],
  });

  const c = result.layouts[0]!.pieces.find((piece) => piece.pieceId === 'c');

  expect(c!.placement).toEqual({ x: 0, y: 40, rotation: 0 });
  expect(result.layouts[0]!.usedHeight).toBe(60);
});

it('uses exact contact for explicit required free PNGs while retaining the legacy untyped search', () => {
  expect(nestMultiplePieces(input()).layouts[0]!.pieces[1]!.placement.x).toBe(40);
  expect(nestMultiplePieces(input('free-png')).layouts[0]!.pieces[1]!.placement.x).toBe(33);
});

it.each(['normal', 'max'] as const)('keeps %s fillers after required garments with frozen height', (mode) => {
  const data: MultiNestingInput = {...input('garment'),pieces:[...input('garment').pieces,
    {id:'png',kind:'free-png',polygon:rect(10,10),allowedRotations:[0,90,-90,180]}]};
  const required = nestMultiplePieces(data);
  const filled = nestMultiplePieces({...data,fillers:[{definitionId:'png',requiredPieceId:'png',priority:1,mode}]});
  expect(filled.extraCount).toBeGreaterThan(0);
  expect(filled.layouts).toHaveLength(required.layouts.length);
  for (const [i,layout] of filled.layouts.entries()) {
    expect(layout.pieces.filter(p=>!p.extra)).toEqual(required.layouts[i]!.pieces);
    expect(layout.usedHeight).toBe(required.layouts[i]!.usedHeight);
    expect(layout.requiredUsedHeight).toBe(required.layouts[i]!.usedHeight);
  }
});

it('places irregular contours validly with allowed rotations', () => {
  const data: MultiNestingInput = {
    canvas: { width: 100, height: 100 },
    scanStepMm: 10,
    pieces: [
      {
        id: 'a',
        kind: 'garment',
        polygon: [
          { x: 0, y: 0 },
          { x: 63, y: 0 },
          { x: 63, y: 13 },
          { x: 13, y: 13 },
          { x: 13, y: 63 },
          { x: 0, y: 63 },
        ],
        allowedRotations: [0],
      },
      {
        id: 'b',
        kind: 'garment',
        polygon: rect(27, 18),
        allowedRotations: [90, -90],
      },
    ],
  };

  const result = nestMultiplePieces(data);

  expect(result.layouts).toHaveLength(1);

  const [a, b] = result.layouts[0]!.pieces;

  expect(polygonsOverlap(a!.polygon, b!.polygon)).toBe(false);
  expect([90, -90]).toContain(b!.placement.rotation);
});

it('recognizes vertex-edge and shared-edge contact but not a positive gap', () => {
  const a = rect(10, 10);
  expect(polygonsTouch(a, rect(10,10).map(p=>({x:p.x+10,y:p.y})))).toBe(true);
  expect(polygonsTouch(a, rect(10,10).map(p=>({x:p.x+10.01,y:p.y})))).toBe(false);
});

it('measures contact search on 96 repeated garments without adding canvases', () => {
  const data: MultiNestingInput = { canvas: {width:1480,height:1000}, scanStepMm:10,
    pieces: Array.from({length:96}, (_,i)=>({id:String(i),polygon:rect(103,137),allowedRotations:[0,180]})) };
  const start = performance.now();
  const previous = nestMultiplePieces(data);
  const baselineMs = performance.now() - start;
  const contactStart = performance.now();
  const contactChecks = vi.spyOn(contactGeometry, 'polygonsTouch');
  const contact = nestMultiplePieces({...data,pieces:data.pieces.map(p=>({...p,kind:'garment'}))});
  const contactMs = performance.now() - contactStart;
  const checkedContacts = contactChecks.mock.calls.length;
  contactChecks.mockRestore();
  // Linear budget on this fixture; the previous exhaustive tie check made 15,578 calls.
  expect(checkedContacts).toBeLessThanOrEqual(data.pieces.length * 8);
  expect(contact.layouts.length).toBeLessThanOrEqual(previous.layouts.length);
  expect(contact.placedCount).toBe(96);
  expect(contact.layouts).toHaveLength(1);
  expect(contact.layouts[0]!.usedHeight).toBe(959);
  expect(contact.diagnostics!.candidatePlacementsTested).toBeLessThan(23401);
  // Reproducible synthetic benchmark, not the user's real production batch.
  console.info(JSON.stringify({baselineMs,contactMs,baselineCandidates:previous.diagnostics!.candidatePlacementsTested,
    contactCandidates:contact.diagnostics!.candidatePlacementsTested,layouts:contact.layouts.length}));
});
