import {
  HARD_MAX_CALANDRA_HEIGHT,
  HARD_MAX_CANVAS_WIDTH,
  type CanvasProfile,
} from './canvas-profile';

export interface CanvasProfileValidationError {
  readonly field: 'id' | 'name' | 'maxWidth' | 'maxHeight' | 'defaultPpi';
  readonly message: string;
}

export function validateCanvasProfile(
  profile: CanvasProfile,
): CanvasProfileValidationError[] {
  const errors: CanvasProfileValidationError[] = [];

  if (profile.id.trim().length === 0) {
    errors.push({
      field: 'id',
      message: 'El perfil debe tener un identificador.',
    });
  }

  if (profile.name.trim().length === 0) {
    errors.push({
      field: 'name',
      message: 'El perfil debe tener un nombre.',
    });
  }

  if (!Number.isFinite(profile.maxWidth) || profile.maxWidth <= 0) {
    errors.push({
      field: 'maxWidth',
      message: 'El ancho máximo debe ser mayor que cero.',
    });
  } else if (profile.maxWidth > HARD_MAX_CANVAS_WIDTH) {
    errors.push({
      field: 'maxWidth',
      message: 'El ancho máximo no puede superar 1480 mm.',
    });
  }

  if (!Number.isFinite(profile.maxHeight) || profile.maxHeight <= 0) {
    errors.push({
      field: 'maxHeight',
      message: 'El alto máximo debe ser mayor que cero.',
    });
  }

  if (
    profile.kind === 'calandra' &&
    profile.maxHeight > HARD_MAX_CALANDRA_HEIGHT
  ) {
    errors.push({
      field: 'maxHeight',
      message: 'Calandra no puede superar los 5000 mm de largo.',
    });
  }

  if (!Number.isFinite(profile.defaultPpi) || profile.defaultPpi <= 0) {
    errors.push({
      field: 'defaultPpi',
      message: 'El PPI debe ser mayor que cero.',
    });
  }

  return errors;
}

export function isCanvasProfileValid(profile: CanvasProfile): boolean {
  return validateCanvasProfile(profile).length === 0;
}
