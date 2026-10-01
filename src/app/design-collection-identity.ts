import { normalizeDesignName } from '../domain/order-import';
import { normalizeDesignSourcePath } from './bulk-design-discovery';
import type { DesignCollection } from './design-collection-state';

export function mergeDesignCollectionList(current: readonly DesignCollection[], incoming: readonly DesignCollection[]): DesignCollection[] {
  const next = [...current];
  for (const collection of incoming) {
    let matches = next.flatMap((item, index) => item.id === collection.id ? [index] : []);
    if (!matches.length && collection.sourceFolderPath) {
      const sourceKey = normalizeDesignSourcePath(collection.sourceFolderPath);
      matches = next.flatMap((item, index) => item.sourceFolderPath && normalizeDesignSourcePath(item.sourceFolderPath) === sourceKey ? [index] : []);
    }
    if (!matches.length) {
      matches = next.flatMap((item, index) => normalizeDesignName(item.name) === normalizeDesignName(collection.name) ? [index] : []);
      if (matches.some(index => next[index]!.sourceFolderPath && collection.sourceFolderPath &&
          normalizeDesignSourcePath(next[index]!.sourceFolderPath!) !== normalizeDesignSourcePath(collection.sourceFolderPath))) {
        throw new Error(`Identidad ambigua para ${collection.name}: las carpetas fuente son distintas.`);
      }
    }
    if (matches.length > 1) throw new Error(`Identidad ambigua para ${collection.name}: varias colecciones existentes.`);
    const index = matches[0];
    if (index === undefined) next.push(collection);
    else next[index] = { ...collection, id: next[index]!.id };
  }
  return next;
}
