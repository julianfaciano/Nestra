import type { Millimeters } from './units';
import type { CanvasProfile } from './canvas-profile';

export interface CanvasDimensions {
  readonly width: Millimeters;
  readonly height: Millimeters;
}

export interface ProductionCanvas {
  readonly profileId: CanvasProfile['id'];
  readonly dimensions: CanvasDimensions;
}
