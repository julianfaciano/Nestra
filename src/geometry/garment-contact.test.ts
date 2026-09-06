import { expect, it } from 'vitest';
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

it('prefers exact garment contact over the old valid gapped grid position, then compact height', () => {
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

it('keeps free PNG placement and diagnostics identical to the original search', () => {
  expect(nestMultiplePieces(input('free-png'))).toEqual(nestMultiplePieces(input()));
});

it('finds valid contact for irregular contours with allowed rotations', () => {
  const data: MultiNestingInput = { canvas: { width: 100, height: 100 }, scanStepMm: 10,
    pieces: [
      { id: 'a', kind: 'garment', polygon: [{x:0,y:0},{x:63,y:0},{x:63,y:13},{x:13,y:13},{x:13,y:63},{x:0,y:63}], allowedRotations: [0] },
      { id: 'b', kind: 'garment', polygon: rect(27, 18), allowedRotations: [90, -90] },
    ] };
  const result = nestMultiplePieces(data);
  expect(result.layouts).toHaveLength(1);
  const [a,b] = result.layouts[0]!.pieces;
  expect(polygonsTouch(a!.polygon, b!.polygon)).toBe(true);
  expect(polygonsOverlap(a!.polygon, b!.polygon)).toBe(false);
  expect([90,-90]).toContain(b!.placement.rotation);
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
  const contact = nestMultiplePieces({...data,pieces:data.pieces.map(p=>({...p,kind:'garment'}))});
  const contactMs = performance.now() - contactStart;
  expect(contact.layouts.length).toBeLessThanOrEqual(previous.layouts.length);
  expect(contact.placedCount).toBe(96);
  // Reproducible synthetic benchmark, not the user's real production batch.
  console.info(JSON.stringify({baselineMs,contactMs,baselineCandidates:previous.diagnostics!.candidatePlacementsTested,
    contactCandidates:contact.diagnostics!.candidatePlacementsTested,layouts:contact.layouts.length}));
});
