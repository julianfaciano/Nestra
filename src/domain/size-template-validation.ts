import type { SizeTemplate } from './size-template';

export type SizeTemplateValidationField =
  | 'fileName'
  | 'mimeType'
  | 'widthPx'
  | 'heightPx'
  | 'physicalWidth'
  | 'physicalHeight';

export interface SizeTemplateValidationError {
  readonly field: SizeTemplateValidationField;
  readonly message: string;
}

export function validateSizeTemplate(
  template: SizeTemplate,
): SizeTemplateValidationError[] {
  const errors: SizeTemplateValidationError[] = [];

  if (template.source.fileName.trim().length === 0) {
    errors.push({
      field: 'fileName',
      message: 'La silueta debe tener un nombre de archivo.',
    });
  }

  if (template.source.mimeType !== 'image/png') {
    errors.push({
      field: 'mimeType',
      message: 'La silueta debe ser un archivo PNG.',
    });
  }

  if (
    !Number.isInteger(template.source.widthPx) ||
    template.source.widthPx <= 0
  ) {
    errors.push({
      field: 'widthPx',
      message: 'El ancho en píxeles debe ser un entero mayor que cero.',
    });
  }

  if (
    !Number.isInteger(template.source.heightPx) ||
    template.source.heightPx <= 0
  ) {
    errors.push({
      field: 'heightPx',
      message: 'El alto en píxeles debe ser un entero mayor que cero.',
    });
  }

  if (
    !Number.isFinite(template.physicalSize.width) ||
    template.physicalSize.width <= 0
  ) {
    errors.push({
      field: 'physicalWidth',
      message: 'El ancho físico debe ser mayor que cero.',
    });
  }

  if (
    !Number.isFinite(template.physicalSize.height) ||
    template.physicalSize.height <= 0
  ) {
    errors.push({
      field: 'physicalHeight',
      message: 'El alto físico debe ser mayor que cero.',
    });
  }

  return errors;
}

export function isSizeTemplateValid(template: SizeTemplate): boolean {
  return validateSizeTemplate(template).length === 0;
}
