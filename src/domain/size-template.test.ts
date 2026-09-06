import { describe, expect, it } from 'vitest';
import { mm } from './units';
import { createSizeTemplateId, type SizeTemplate } from './size-template';
import {
  isSizeTemplateValid,
  validateSizeTemplate,
} from './size-template-validation';

function createValidTemplate(): SizeTemplate {
  return {
    id: createSizeTemplateId('T8', 'front'),
    size: 'T8',
    side: 'front',
    physicalSize: {
      width: mm(410),
      height: mm(520),
    },
    source: {
      fileName: 't8-frente.png',
      mimeType: 'image/png',
      widthPx: 4843,
      heightPx: 6142,
    },
  };
}

describe('SizeTemplate', () => {
  it('crea un id determinista', () => {
    expect(createSizeTemplateId('T8', 'front')).toBe('t8-front');
    expect(createSizeTemplateId('T10', 'back')).toBe('t10-back');
  });

  it('acepta una silueta válida', () => {
    expect(isSizeTemplateValid(createValidTemplate())).toBe(true);
  });

  it('rechaza dimensiones físicas inválidas', () => {
    const template: SizeTemplate = {
      ...createValidTemplate(),
      physicalSize: {
        width: mm(0),
        height: mm(520),
      },
    };

    expect(validateSizeTemplate(template)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'physicalWidth',
        }),
      ]),
    );
  });

  it('rechaza dimensiones raster inválidas', () => {
    const template: SizeTemplate = {
      ...createValidTemplate(),
      source: {
        ...createValidTemplate().source,
        widthPx: 0,
      },
    };

    expect(validateSizeTemplate(template)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'widthPx',
        }),
      ]),
    );
  });
});
