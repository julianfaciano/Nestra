import { describe, expect, it } from 'vitest';
import {
  contoursViolateClearance,
  indexClearanceContours,
  indexedContoursViolateClearance,
  prepareClearanceContours,
} from './polygon-clearance';
import type { Polygon } from './polygon';

const rect = (width: number, height: number, x = 0, y = 0): Polygon => [
  { x, y },
  { x: x + width, y },
  { x: x + width, y: y + height },
  { x, y: y + height },
];

const move = (polygon: Polygon, x: number, y: number): Polygon =>
  polygon.map(point => ({ x: point.x + x, y: point.y + y }));

function indexedViolation(moving: Polygon[], fixed: Polygon[], x: number, y: number, clearance: number) {
  return indexedContoursViolateClearance(
    prepareClearanceContours(moving),
    x,
    y,
    indexClearanceContours(prepareClearanceContours(fixed)),
    clearance,
  );
}

describe('exact indexed contour clearance', () => {
  it.each([
    [25, true],
    [25.999, true],
    [26, false],
    [26.001, false],
    [18, true],
  ] as const)('matches the exact reference at horizontal offset %s', (x, expected) => {
    const a = rect(20, 20);
    const b = rect(20, 20);
    expect(indexedViolation([a], [b], x, 0, 6)).toBe(expected);
    expect(indexedViolation([a], [b], x, 0, 6)).toBe(
      contoursViolateClearance([move(a, x, 0)], [b], 6),
    );
  });

  it('matches exact segment and containment handling across multiple islands', () => {
    const moving = [rect(14, 12), rect(5, 5, 26, 4)];
    const fixed = [rect(20, 20), rect(6, 6, 60, 10)];
    for (const [x, y] of [[0, 0], [24, 0], [38, 8], [80, 0], [-32, -4]] as const) {
      expect(indexedViolation(moving, fixed, x, y, 6)).toBe(
        contoursViolateClearance(moving.map(p => move(p, x, y)), fixed, 6),
      );
    }
    expect(indexedViolation([rect(2, 2, 4, 4)], [rect(40, 40)], 0, 0, 6)).toBe(true);
  });

  it('uses segment AABBs to avoid unrelated exact edge-pair checks', () => {
    const contour = Array.from({ length: 512 }, (_, i) => ({
      x: 100 + 80 * Math.cos(i * Math.PI * 2 / 512),
      y: 100 + 55 * Math.sin(i * Math.PI * 2 / 512),
    }));
    const counters = {
      clearanceIndexedCalls: 0,
      clearanceSegmentCandidates: 0,
      clearanceSegmentAabbChecks: 0,
      clearanceSegmentExactChecks: 0,
    };
    const prepared = prepareClearanceContours([contour]);
    const violates = indexedContoursViolateClearance(
      prepared,
      250,
      0,
      indexClearanceContours(prepared),
      6,
      counters,
    );
    expect(violates).toBe(false);
    expect(counters.clearanceIndexedCalls).toBe(1);
    expect(counters.clearanceSegmentExactChecks).toBeLessThan(512);
  });
});
