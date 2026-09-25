import { expect, it } from 'vitest';
import type { Polygon } from './polygon';
import { createPolygonCollisionDiagnostics, polygonsOverlap } from './polygon-collision';
import { getPolygonBounds } from './polygon-transform';

function rectangle(x:number,y:number,width:number,height:number):Polygon {
  return [{x,y},{x:x+width,y},{x:x+width,y:y+height},{x,y:y+height}];
}

it('counts exact checks, segment AABB work, intersections and containment only when requested',()=>{
  const diagnostics=createPolygonCollisionDiagnostics();
  const first=rectangle(0,0,10,10);
  const overlap=rectangle(5,2,10,6);
  const touching=rectangle(10,0,10,10);
  const contained=rectangle(2,2,2,2);

  expect(polygonsOverlap(first,overlap,getPolygonBounds(first),getPolygonBounds(overlap),undefined,undefined,diagnostics)).toBe(true);
  expect(polygonsOverlap(first,touching,getPolygonBounds(first),getPolygonBounds(touching),undefined,undefined,diagnostics)).toBe(false);
  expect(polygonsOverlap(rectangle(0,0,20,20),contained,getPolygonBounds(rectangle(0,0,20,20)),getPolygonBounds(contained),undefined,undefined,diagnostics)).toBe(true);

  expect(diagnostics.exactCollisionCalls).toBe(3);
  expect(diagnostics.exactCollisionEarlyRejects).toBe(1);
  expect(diagnostics.exactCollisionSegmentPairCandidates).toBe(
    diagnostics.exactCollisionSegmentPairAabbRejects+diagnostics.exactCollisionSegmentPairTests,
  );
  expect(diagnostics.exactCollisionSegmentIntersections).toBeGreaterThan(0);
  expect(diagnostics.exactCollisionContainmentTests).toBeGreaterThan(0);
});
