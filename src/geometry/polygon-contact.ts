import type { Polygon, Point2D } from './polygon';

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
export function polygonsTouch(a: Polygon, b: Polygon): boolean {
  for (let i = 0; i < a.length; i++) {
    const p = a[i]!;
    const q = a[(i + 1) % a.length]!;
    for (let j = 0; j < b.length; j++) {
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
