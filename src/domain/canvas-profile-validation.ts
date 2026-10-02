import {
  canvasProfileHeightLimit,
  nominalSilhouetteClearanceMm,
  outlineExtentMm,
  canvasProfileWidthLimit,
  type CanvasProfile,
} from './canvas-profile';

export interface CanvasProfileValidationError {
  readonly field:
    | 'id'
    | 'name'
    | 'maxWidth'
    | 'maxHeight'
    | 'defaultPpi'
    | 'minimumVisibleGapMm'
    | 'laserCutOutlineWidthMm';
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
  } else if (profile.maxWidth > canvasProfileWidthLimit(profile)) {
    errors.push({
      field: 'maxWidth',
      message: `El ancho máximo no puede superar ${canvasProfileWidthLimit(profile)} mm.`,
    });
  }

  if (!Number.isFinite(profile.maxHeight) || profile.maxHeight <= 0) {
    errors.push({
      field: 'maxHeight',
      message: 'El alto máximo debe ser mayor que cero.',
    });
  }

  if (
    profile.kind !== 'imprenta' &&
    profile.maxHeight > canvasProfileHeightLimit(profile)
  ) {
    errors.push({
      field: 'maxHeight',
      message: `${profile.name} no puede superar los ${canvasProfileHeightLimit(profile)} mm de largo.`,
    });
  }

  if (!Number.isFinite(profile.defaultPpi) || profile.defaultPpi <= 0) {
    errors.push({
      field: 'defaultPpi',
      message: 'El PPI debe ser mayor que cero.',
    });
  }

  if (
    !Number.isFinite(profile.minimumVisibleGapMm ?? 0) ||
    (profile.minimumVisibleGapMm ?? 0) < 0
  ) {
    errors.push({
      field: 'minimumVisibleGapMm',
      message: 'La separación libre visible debe ser finita y no negativa.',
    });
  }
  if (
    profile.laserCutOutline &&
    (!Number.isFinite(outlineExtentMm(profile)) ||
      outlineExtentMm(profile) <= 0 ||
      !Number.isFinite(nominalSilhouetteClearanceMm(profile)))
  ) {
    errors.push({
      field: 'laserCutOutlineWidthMm',
      message:
        'El grosor láser debe ser finito y positivo.',
    });
  }
  return errors;
}

export function isCanvasProfileValid(profile: CanvasProfile): boolean {
  return validateCanvasProfile(profile).length === 0;
}
