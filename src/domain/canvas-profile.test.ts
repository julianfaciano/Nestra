import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CALANDRA_PROFILE,
  DEFAULT_IMPRENTA_PROFILE,
  type CanvasProfile,
} from './canvas-profile';
import {
  isCanvasProfileValid,
  validateCanvasProfile,
} from './canvas-profile-validation';
import { mm } from './units';

describe('CanvasProfile', () => {
  it('considera válido el perfil default de imprenta', () => {
    expect(isCanvasProfileValid(DEFAULT_IMPRENTA_PROFILE)).toBe(true);
  });

  it('considera válido el perfil default de calandra', () => {
    expect(isCanvasProfileValid(DEFAULT_CALANDRA_PROFILE)).toBe(true);
  });

  it('rechaza un ancho mayor a 1480 mm', () => {
    const profile: CanvasProfile = {
      ...DEFAULT_IMPRENTA_PROFILE,
      maxWidth: mm(1481),
    };

    expect(validateCanvasProfile(profile)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'maxWidth',
        }),
      ]),
    );
  });

  it('rechaza calandra por encima de 5000 mm', () => {
    const profile: CanvasProfile = {
      ...DEFAULT_CALANDRA_PROFILE,
      maxHeight: mm(5001),
    };

    expect(validateCanvasProfile(profile)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'maxHeight',
        }),
      ]),
    );
  });

  it('permite una imprenta más baja que el máximo actual', () => {
    const profile: CanvasProfile = {
      ...DEFAULT_IMPRENTA_PROFILE,
      maxHeight: mm(630),
    };

    expect(isCanvasProfileValid(profile)).toBe(true);
  });

  it('permite un ancho menor a 1480 mm', () => {
    const profile: CanvasProfile = {
      ...DEFAULT_IMPRENTA_PROFILE,
      maxWidth: mm(1120),
    };

    expect(isCanvasProfileValid(profile)).toBe(true);
  });
});
