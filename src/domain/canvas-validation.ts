import type { CanvasProfile } from './canvas-profile';
import type { CanvasDimensions } from './canvas';

export type CanvasValidationField = 'width' | 'height';

export interface CanvasValidationError {
  readonly field: CanvasValidationField;
  readonly message: string;
}

export function validateCanvasDimensions(
  dimensions: CanvasDimensions,
  profile: CanvasProfile,
): CanvasValidationError[] {
  const errors: CanvasValidationError[] = [];

  if (!Number.isFinite(dimensions.width) || dimensions.width <= 0) {
    errors.push({
      field: 'width',
      message: 'El ancho del canvas debe ser mayor que cero.',
    });
  } else if (dimensions.width > profile.maxWidth) {
    errors.push({
      field: 'width',
      message: `El ancho del canvas supera el máximo del perfil (${profile.maxWidth} mm).`,
    });
  }

  if (!Number.isFinite(dimensions.height) || dimensions.height <= 0) {
    errors.push({
      field: 'height',
      message: 'El alto del canvas debe ser mayor que cero.',
    });
  } else if (dimensions.height > profile.maxHeight) {
    errors.push({
      field: 'height',
      message: `El alto del canvas supera el máximo del perfil (${profile.maxHeight} mm).`,
    });
  }

  return errors;
}

export function canvasFitsProfile(
  dimensions: CanvasDimensions,
  profile: CanvasProfile,
): boolean {
  return validateCanvasDimensions(dimensions, profile).length === 0;
}
