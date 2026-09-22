import type { Polygon, Point2D } from './polygon';
import { createPolygonSegmentQuery } from './polygon-collision';

const EPSILON = 1e-9;

function onSegment(p: Point2D, a: Point2D, b: Point2D): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
    ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy) <= EPSILON;
}

/** Boundary contact only; callers must first reject overlapping polygons. */
export function polygonsTouch(a: Polygon, b: Polygon, candidates?: (p:Point2D,q:Point2D)=>readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const p = a[i]!;
    const q = a[(i + 1) % a.length]!;
    const indices=candidates?.(p,q);
    for (let offset = 0; offset < (indices?.length ?? b.length); offset++) {
      const j=indices ? indices[offset]! : offset;
      const r = b[j]!;
      const s = b[(j + 1) % b.length]!;
      if (Math.max(p.x, q.x) + EPSILON < Math.min(r.x, s.x) ||
          Math.max(r.x, s.x) + EPSILON < Math.min(p.x, q.x) ||
          Math.max(p.y, q.y) + EPSILON < Math.min(r.y, s.y) ||
          Math.max(r.y, s.y) + EPSILON < Math.min(p.y, q.y)) continue;
      if (onSegment(p, r, s) || onSegment(q, r, s) || onSegment(r, p, q) || onSegment(s, p, q)) return true;
    }
  }
  return false;
}

/** Reuses the filler collision index without changing exact contact predicates. */
export function createIndexedPolygonTouch(segments = createPolygonSegmentQuery()) {
  return (a:Polygon,b:Polygon) => polygonsTouch(a,b,(p,q)=>segments(b,p,q));
}

/** Axis translations within one grid cell, derived from vertex/edge contact.
 * The segment index restricts the pairs spatially; no global vertex product.
 * Callers still validate exact overlap, material bounds and actual contact.
 */
export function* localContourSnaps(
  moving: readonly Polygon[], x:number, y:number, stationary:readonly Polygon[],
  distance:number, segments:ReturnType<typeof createPolygonSegmentQuery>,
): Generator<Point2D> {
  // Every projection moves one axis only. Numeric sets remove repeated endpoint
  // projections locally, preserving the first occurrence and its exact floats.
  // This caches coordinates only; the caller still validates every new snap.
  const horizontal = new Set<number>();
  const vertical = new Set<number>();
  const snaps: Point2D[] = [];
  const append = (nextX: number, nextY: number) => {
    const seen = nextX === x ? vertical : horizontal;
    const coordinate = nextX === x ? nextY : nextX;
    if (seen.has(coordinate)) return;
    seen.add(coordinate);
    snaps.push({x:nextX,y:nextY});
  };
  function project(p:Point2D,a:Point2D,b:Point2D,sign:number):void {
    if (a.y !== b.y) {
      const t=(p.y-a.y)/(b.y-a.y);
      if(t>=0 && t<=1) {
        const dx=sign*(a.x+t*(b.x-a.x)-p.x);
        if(dx!==0 && Math.abs(dx)<=distance) append(x+dx,y);
      }
    }
    if (a.x !== b.x) {
      const t=(p.x-a.x)/(b.x-a.x);
      if(t>=0 && t<=1) {
        const dy=sign*(a.y+t*(b.y-a.y)-p.y);
        if(dy!==0 && Math.abs(dy)<=distance) append(x,y+dy);
      }
    }
  }
  for(const polygon of moving) for(let i=0;i<polygon.length;i++) {
    const a={x:polygon[i]!.x+x,y:polygon[i]!.y+y};
    const next=polygon[(i+1)%polygon.length]!;
    const b={x:next.x+x,y:next.y+y};
    const min={x:Math.min(a.x,b.x)-distance,y:Math.min(a.y,b.y)-distance};
    const max={x:Math.max(a.x,b.x)+distance,y:Math.max(a.y,b.y)+distance};
    for(const neighbor of stationary) for(const index of segments(neighbor,min,max)) {
      const c=neighbor[index]!,d=neighbor[(index+1)%neighbor.length]!;
      project(a,c,d,1);
      project(c,a,b,-1);
      project(d,a,b,-1);
    }
  }
  yield* snaps;
}
