import { expect, it } from 'vitest';
import { extractAlphaComponents } from './alpha-polygon';
import { componentEnvelope, componentsOverlap, transformComponents } from './polygon-components';
import { getPolygonBounds } from './polygon-transform';
import { nestMultiplePieces, type MultiNestingInput } from './multi-piece-nesting-engine';
import { rect } from '../test/fill-gaps-fixture';

const at = (w:number,h:number,x:number,y:number) => rect(w,h).map(p=>({x:p.x+x,y:p.y+y}));
const islands = [at(20,20,0,10),at(4,4,0,0)];

it('extracts the shield and separate star, including a single opaque pixel', () => {
  const data = new Uint8ClampedArray(20*30*4);
  for(let y=10;y<30;y++) for(let x=0;x<20;x++) data[(y*20+x)*4+3]=255;
  data[3]=255;
  const components = extractAlphaComponents({width:20,height:30,data},1);
  expect(components).toHaveLength(2);
  expect(components.map(p=>getPolygonBounds(p).width).sort((a,b)=>a-b)).toEqual([1,20]);
  expect(getPolygonBounds(componentEnvelope(components))).toMatchObject({minY:0,maxY:30});
});

it('rejects overlap of only the secondary island while allowing touching and empty gaps', () => {
  const intruder = at(4,4,1,0);
  expect(componentsOverlap([islands[0]!],[intruder])).toBe(false);
  expect(componentsOverlap(islands,[intruder])).toBe(true);
  expect(componentsOverlap(islands,[at(4,4,4,0)])).toBe(false);
  expect(componentsOverlap(islands,[at(4,4,8,0)])).toBe(false);
});

it.each([0,90,-90,180] as const)('rotates every island together at %s degrees with global bounds', rotation => {
  const transformed = transformComponents(islands,{x:7,y:11,rotation});
  const bounds = getPolygonBounds(componentEnvelope(transformed));
  expect(bounds).toMatchObject({minX:7,minY:11,width:rotation===0||rotation===180?20:30,height:rotation===0||rotation===180?30:20});
  expect(transformed).toHaveLength(2);
  expect(componentsOverlap([transformed[0]!],[transformed[1]!])).toBe(false);
  expect(transformed[1]![0]).toEqual(rotation===0?{x:7,y:11}:rotation===90?{x:37,y:11}:rotation===-90?{x:7,y:31}:{x:27,y:41});
});

function input(): MultiNestingInput {
  return {canvas:{width:20,height:30},scanStepMm:2,pieces:[
    {id:'shield',kind:'free-png',polygon:componentEnvelope(islands),collisionComponents:islands,allowedRotations:[0]},
    {id:'small',kind:'free-png',polygon:rect(4,4),allowedRotations:[0]},
  ]};
}

it('required free PNG rejects the occupied star position and remains deterministic', () => {
  const result = nestMultiplePieces(input());
  expect(result.layouts).toHaveLength(1);
  expect(result.placedCount).toBe(2);
  const [a,b] = result.layouts[0]!.pieces;
  expect(b!.placement).not.toMatchObject({x:0,y:0});
  expect(componentsOverlap(a!.collisionComponents!,[b!.polygon])).toBe(false);
  expect(result).toEqual(nestMultiplePieces(input()));
});

it.each(['normal','max'] as const)('%s fillers respect secondary islands and frozen material', mode => {
  const data = {...input(),fillers:[{definitionId:'small',requiredPieceId:'small',priority:1,mode}]};
  const result = nestMultiplePieces(data);
  expect(result.extraCount).toBeGreaterThan(0);
  expect(result.layouts).toHaveLength(1);
  const layout=result.layouts[0]!;
  expect(layout.usedHeight).toBe(30);
  expect(layout.requiredUsedHeight).toBe(30);
  for(const [i,p] of layout.pieces.entries()) {
    expect(getPolygonBounds(p.polygon).maxY).toBeLessThanOrEqual(30);
    for(const q of layout.pieces.slice(i+1)) expect(componentsOverlap(p.collisionComponents??[p.polygon],q.collisionComponents??[q.polygon])).toBe(false);
  }
  expect(result).toEqual(nestMultiplePieces(data));
});

it('additional copies of a multi-island filler retain every island in one placement', () => {
  const data: MultiNestingInput = {canvas:{width:60,height:30},scanStepMm:2,pieces:[input().pieces[0]!],
    fillers:[{definitionId:'shield',requiredPieceId:'shield',priority:1,mode:'max'}]};
  const result=nestMultiplePieces(data);
  expect(result.extraCount).toBeGreaterThan(0);
  expect(result.layouts).toHaveLength(1);
  const layout=result.layouts[0]!;
  expect(layout.usedHeight).toBe(30);
  for(const [i,p] of layout.pieces.entries()) {
    expect(p.collisionComponents).toHaveLength(2);
    for(const q of layout.pieces.slice(i+1)) expect(componentsOverlap(p.collisionComponents!,q.collisionComponents!)).toBe(false);
  }
});
