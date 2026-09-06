import { describe, expect, it } from 'vitest';
import {
  buildDesignCollection,
  findCollectionAsset,
  isCollectionComplete,
} from './design-collection-state';

function createFolderFile(
  fileName: string,
  folderName = 'River Suplente 2026',
): File {
  const file = new File(
    ['png'],
    fileName,
    {
      type: 'image/png',
    },
  );

  Object.defineProperty(
    file,
    'webkitRelativePath',
    {
      value: `${folderName}/${fileName}`,
    },
  );

  return file;
}

function buildCompleteFolder(): File[] {
  const files: File[] = [];

  for (let size = 1; size <= 10; size += 1) {
    const frontSequence = String(
      (size - 1) * 2,
    ).padStart(4, '0');

    const backSequence = String(
      (size - 1) * 2 + 1,
    ).padStart(4, '0');

    files.push(
      createFolderFile(
        `RIV26S_${frontSequence}_T${size}-FRENTE.png`,
      ),
    );

    files.push(
      createFolderFile(
        `RIV26S_${backSequence}_T${size}-DORSO.png`,
      ),
    );
  }

  return files;
}

describe('design collection state', () => {
  it('construye una colección completa desde una carpeta', () => {
    const collection = buildDesignCollection(
      buildCompleteFolder(),
      'river-suplente-2026',
    );

    expect(collection.name).toBe(
      'River Suplente 2026',
    );

    expect(collection.assets).toHaveLength(20);
    expect(collection.missing).toHaveLength(0);
    expect(isCollectionComplete(collection)).toBe(true);
  });

  it('conserva la carpeta fuente cuando se proporciona', () => {
    const collection = buildDesignCollection(
      buildCompleteFolder(),
      'river-suplente-2026',
      'C:\\Diseños\\River Suplente 2026',
    );

    expect(collection.sourceFolderPath).toBe(
      'C:\\Diseños\\River Suplente 2026',
    );
  });

  it('conserva los objetos File originales', () => {
    const files = buildCompleteFolder();

    const collection = buildDesignCollection(
      files,
      'river-suplente-2026',
    );

    const front = findCollectionAsset(
      collection,
      'T1',
      'front',
    );

    expect(front?.file).toBe(files[0]);
    expect(front?.fileName).toContain(
      'T1-FRENTE.png',
    );
  });

  it('detecta una colección incompleta', () => {
    const files = buildCompleteFolder().filter(
      (file) =>
        !file.name.includes('T6-DORSO'),
    );

    const collection = buildDesignCollection(
      files,
      'river-suplente-2026',
    );

    expect(collection.assets).toHaveLength(19);
    expect(collection.missing).toContainEqual({
      size: 'T6',
      side: 'back',
    });

    expect(isCollectionComplete(collection)).toBe(false);
  });

  it('permite buscar un talle y lado concreto', () => {
    const collection = buildDesignCollection(
      buildCompleteFolder(),
      'river-suplente-2026',
    );

    const asset = findCollectionAsset(
      collection,
      'T10',
      'back',
    );

    expect(asset?.size).toBe('T10');
    expect(asset?.side).toBe('back');
    expect(asset?.fileName).toContain(
      'T10-DORSO.png',
    );
  });
});
