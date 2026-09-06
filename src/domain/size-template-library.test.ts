import { describe, expect, it } from 'vitest';
import { findSizeTemplate } from './size-template-library';
import { createSizeTemplateId, type SizeTemplate } from './size-template';
import { mm } from './units';

const template: SizeTemplate = {
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

describe('SizeTemplateLibrary', () => {
  it('encuentra una silueta por talle y lado', () => {
    expect(
      findSizeTemplate(
        {
          templates: [template],
        },
        'T8',
        'front',
      ),
    ).toEqual(template);
  });

  it('devuelve undefined cuando no existe', () => {
    expect(
      findSizeTemplate(
        {
          templates: [template],
        },
        'T7',
        'back',
      ),
    ).toBeUndefined();
  });
});
