import { mm, type Millimeters } from './units';

export type CanvasProfileKind = 'imprenta' | 'calandra' | 'imprenta-2';

export interface CanvasProfile {
  readonly id: string;
  readonly name: string;
  readonly kind: CanvasProfileKind;
  readonly maxWidth: Millimeters;
  readonly maxHeight: Millimeters;
  readonly defaultPpi: number;
  /** Minimum free distance between the exterior edges of centered strokes. */
  readonly minimumVisibleGapMm?: number;
  readonly laserCutOutline?: boolean;
  readonly laserCutOutlineWidthMm?: number;
}

export const HARD_MAX_CANVAS_WIDTH = mm(1480);
export const IMPRENTA_2_MAX_CANVAS_WIDTH = mm(1560);
export const HARD_MAX_CALANDRA_HEIGHT = mm(5000);

export const DEFAULT_IMPRENTA_PROFILE: CanvasProfile = {
  id: 'imprenta',
  name: 'Imprenta',
  kind: 'imprenta',
  maxWidth: mm(1480),
  maxHeight: mm(1000),
  defaultPpi: 300,
};

export const DEFAULT_CALANDRA_PROFILE: CanvasProfile = {
  id: 'calandra',
  name: 'Calandra',
  kind: 'calandra',
  maxWidth: mm(1480),
  maxHeight: mm(5000),
  defaultPpi: 300,
};

/** A centered stroke consumes its full width from the nominal silhouette gap. */
export const PRODUCTIVE_EXPORT_PPI = 300;
export const LASER_CUT_OUTLINE_WIDTH_MM = 3;
export const IMPRENTA_2_MINIMUM_VISIBLE_GAP_MM = 3;
export const LASER_CUT_OUTLINE_COLOR = '#000000';
export const DEFAULT_IMPRENTA_2_PROFILE: CanvasProfile = {
  id: 'imprenta-2',
  name: 'Imprenta 2',
  kind: 'imprenta-2',
  maxWidth: IMPRENTA_2_MAX_CANVAS_WIDTH,
  maxHeight: mm(5000),
  defaultPpi: 300,
  minimumVisibleGapMm: IMPRENTA_2_MINIMUM_VISIBLE_GAP_MM,
  laserCutOutline: true,
  laserCutOutlineWidthMm: LASER_CUT_OUTLINE_WIDTH_MM,
};
export const CANVAS_PROFILES = [
  DEFAULT_CALANDRA_PROFILE,
  DEFAULT_IMPRENTA_PROFILE,
  DEFAULT_IMPRENTA_2_PROFILE,
] as const;
export function canvasProfileHeightLimit(profile: CanvasProfile): number {
  return profile.kind === 'imprenta' ? 1000 : HARD_MAX_CALANDRA_HEIGHT;
}
export function canvasProfileWidthLimit(profile: CanvasProfile): number {
  return profile.kind === 'imprenta-2' ? IMPRENTA_2_MAX_CANVAS_WIDTH : HARD_MAX_CANVAS_WIDTH;
}
export function outlineExtentMm(profile: CanvasProfile): number {
  return profile.laserCutOutline
    ? (profile.laserCutOutlineWidthMm ?? LASER_CUT_OUTLINE_WIDTH_MM) / 2
    : 0;
}

/**
 * Required distance between nominal cut silhouettes. With a centered stroke,
 * each neighboring stroke extends half its width toward the gap, so together
 * they consume one full stroke width.
 */
export function nominalSilhouetteClearanceMm(profile: CanvasProfile): number {
  const visibleGap = profile.minimumVisibleGapMm ?? 0;
  const strokeWidth = profile.laserCutOutline
    ? profile.laserCutOutlineWidthMm ?? LASER_CUT_OUTLINE_WIDTH_MM
    : 0;
  return visibleGap + strokeWidth;
}

/** Raster-safe physical limits: only laser profiles need the complete centered line.
 * Fixed 300-PPI export rounds raster width down by less than one pixel; reserve that fraction
 * at the right/bottom, never a clearance-sized material margin.
 */
export function nestingCanvasForProfile(profile: CanvasProfile) {
  const pixelsPerMm = PRODUCTIVE_EXPORT_PPI / 25.4;
  const exteriorStrokeMargin = outlineExtentMm(profile);
  const rasterSafeHeight = profile.laserCutOutline
    ? Math.floor(profile.maxHeight * pixelsPerMm) / pixelsPerMm
    : profile.maxHeight;
  return {
    width: profile.laserCutOutline
      ? Math.floor(profile.maxWidth * pixelsPerMm) / pixelsPerMm
      : profile.maxWidth,
    // Consolidation adds this clear margin above and below each cropped strip.
    // Reserve it before nesting so every accepted layout can be consolidated.
    height: rasterSafeHeight - 2 * exteriorStrokeMargin,
    minimumPieceClearance: nominalSilhouetteClearanceMm(profile),
    outlineExtentMm: exteriorStrokeMargin,
  };
}
