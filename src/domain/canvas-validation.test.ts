import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CALANDRA_PROFILE,
  DEFAULT_IMPRENTA_PROFILE,
} from './canvas-profile';
import {
  canvasFitsProfile,
  validateCanvasDimensions,
} from './canvas-validation';
import { mm } from './units';

describe('validación de canvas', () => {
  it('acepta un canvas menor que el máximo de imprenta', () => {
    expect(
      canvasFitsProfile(
        {
          width: mm(1120),
          height: mm(732),
        },
        DEFAULT_IMPRENTA_PROFILE,
      ),
    ).toBe(true);
  });

  it('acepta exactamente 1480 x 1000 mm en imprenta', () => {
    expect(
      canvasFitsProfile(
        {
          width: mm(1480),
          height: mm(1000),
        },
        DEFAULT_IMPRENTA_PROFILE,
      ),
    ).toBe(true);
  });

  it('rechaza un canvas demasiado ancho para imprenta', () => {
    const errors = validateCanvasDimensions(
      {
        width: mm(1481),
        height: mm(1000),
      },
      DEFAULT_IMPRENTA_PROFILE,
    );

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'width',
        }),
      ]),
    );
  });

  it('rechaza un canvas demasiado alto para imprenta', () => {
    const errors = validateCanvasDimensions(
      {
        width: mm(1480),
        height: mm(1001),
      },
      DEFAULT_IMPRENTA_PROFILE,
    );

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'height',
        }),
      ]),
    );
  });

  it('acepta exactamente 5000 mm de largo en calandra', () => {
    expect(
      canvasFitsProfile(
        {
          width: mm(1480),
          height: mm(5000),
        },
        DEFAULT_CALANDRA_PROFILE,
      ),
    ).toBe(true);
  });

  it('rechaza más de 5000 mm de largo en calandra', () => {
    const errors = validateCanvasDimensions(
      {
        width: mm(1480),
        height: mm(5001),
      },
      DEFAULT_CALANDRA_PROFILE,
    );

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'height',
        }),
      ]),
    );
  });
});
