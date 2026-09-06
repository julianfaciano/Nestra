import { mm, type Millimeters } from './units';

export type CanvasProfileKind = 'imprenta' | 'calandra';

export interface CanvasProfile {
  readonly id: string;
  readonly name: string;
  readonly kind: CanvasProfileKind;
  readonly maxWidth: Millimeters;
  readonly maxHeight: Millimeters;
  readonly defaultPpi: number;
}

export const HARD_MAX_CANVAS_WIDTH = mm(1480);
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
