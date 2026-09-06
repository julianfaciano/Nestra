import type { PieceSide } from './piece-side';
import type { GarmentSize } from './size';
import type { SizeTemplate } from './size-template';

export interface SizeTemplateLibrary {
  readonly templates: readonly SizeTemplate[];
}

export function findSizeTemplate(
  library: SizeTemplateLibrary,
  size: GarmentSize,
  side: PieceSide,
): SizeTemplate | undefined {
  return library.templates.find(
    (template) => template.size === size && template.side === side,
  );
}
